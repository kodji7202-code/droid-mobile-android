import { create } from 'zustand';
import {
  DaemonClientError,
  addPendingUser,
  applyStreamEvent,
  failPendingUser,
  itemsFromMessages,
  reconcileLocalItems,
  markStopped,
  markToolsDenied,
  prependItems,
  redactSecrets,
  removeItem,
  settleTurn,
  appendError,
  appendTurnFailure,
} from '@droidmobile/daemon-client';
import type {
  DaemonConnection,
  SessionHandle,
  TokenUsage,
  TranscriptItem,
  UserAttachment,
} from '@droidmobile/daemon-client';
import { toStreamOptions } from '../features/chat/attachments';
import { runTurn } from '../features/chat/runTurn';
import { useConnectionStore } from './connection';
import { useInteractionStore } from './interactions';

/** Messages requested per getMessages page (the daemon returns them newest first). */
export const HISTORY_PAGE_SIZE = 50;

const FOLLOW_INTERVAL_MS = 2000;
const FOLLOW_ATTEMPTS = 60;

const QUEUE_SETTLE_ATTEMPTS = 6;
const QUEUE_SETTLE_INTERVAL_MS = 1000;

export type SessionViewStatus = 'loading' | 'ready' | 'error';

/** A message the daemon holds until the running turn ends; `requestId` is its id in the daemon's queue. */
export interface QueuedMessage {
  requestId: string;
  text: string;
  attachments?: readonly UserAttachment[];
}

/** Text handed back to the composer; `nonce` makes a repeat of the same text a new event. */
export interface RestoredText {
  text: string;
  attachments?: readonly UserAttachment[];
  nonce: number;
}

/**
 * Per-session state consumed by the chat features: the handle, the loaded
 * history (oldest first) and the settings the daemon reported on open.
 */
export interface SessionView {
  id: string;
  status: SessionViewStatus;
  handle?: SessionHandle;
  /** Conversation items, oldest first, keyed by daemon ids. */
  items: TranscriptItem[];
  /** True from send until the stream ends, is lost or fails. */
  turnActive: boolean;
  /** Last working state reported by the daemon during the active turn. */
  workingState: string;
  /** Messages sent during the active turn that the daemon has not executed yet, oldest first. */
  queued: QueuedMessage[];
  /** Queued text the daemon dropped (interrupt) and the composer should show again. */
  restored?: RestoredText;
  /** Latest token usage the daemon reported for the session (absent until a turn ran). */
  usage?: TokenUsage;
  /** True after the user pressed stop and until the next send. */
  stopRequested: boolean;
  /** Set when the connection dropped mid-turn; cleared on the next send. */
  interrupted: boolean;
  hasMore: boolean;
  nextCursor?: string;
  loadingOlder: boolean;
  modelId?: string;
  cwd?: string;
  /** Connection epoch the view was loaded under; a new epoch triggers a reload. */
  epoch: number;
  error?: string;
}

interface SessionViewStore {
  views: Record<string, SessionView>;
  /** Resumes the session on the daemon and loads the latest page of history. */
  open(connection: DaemonConnection, id: string, epoch: number): Promise<void>;
  /** Registers a session that was just created (no history yet). */
  adopt(handle: SessionHandle, epoch: number): void;
  loadOlder(id: string): Promise<void>;
  /** Shows the user bubble at once and streams the reply into the view. */
  send(id: string, text: string, attachments?: readonly UserAttachment[]): Promise<void>;
  /** Resends a message that never reached the daemon. */
  retry(id: string, itemId: string): Promise<void>;
  /** Removes a queued message from the daemon's queue so it is never executed. */
  cancelQueued(id: string, requestId: string): Promise<void>;
  /** Drops a restored draft once the composer has taken it, so a remount cannot restore it again. */
  consumeRestored(id: string, nonce: number): void;
  interrupt(id: string): Promise<void>;
  /** Shows the tool calls of a refused permission request as denied. */
  markDenied(id: string, tools: Parameters<typeof markToolsDenied>[1]): void;
  /**
   * Tracks a turn this client is not streaming (a request that was replayed after
   * a reload): polls the stored history until the daemon is done working.
   */
  follow(id: string): Promise<void>;
  /** Re-reads the latest history of every idle ready view after the app returns to the foreground. */
  refreshOnResume(): Promise<void>;
  reset(): void;
}

function emptyView(id: string, epoch: number): SessionView {
  return {
    id,
    status: 'loading',
    items: [],
    queued: [],
    turnActive: false,
    workingState: 'idle',
    stopRequested: false,
    interrupted: false,
    hasMore: false,
    loadingOlder: false,
    epoch,
  };
}

let localSeq = 0;
let restoreSeq = 0;

/**
 * Bumped whenever a session's latest history window is replaced. An older-page
 * request started under a previous window is stale: applying it would overwrite
 * the cursor and skip the messages between the two windows.
 */
const historyWindow = new Map<string, number>();
const bumpWindow = (id: string) => historyWindow.set(id, (historyWindow.get(id) ?? 0) + 1);

/** Counts connection replacements; a load that started before one must not write its result. */
let replacements = 0;

const hasPending = (id: string) =>
  useInteractionStore.getState().pending.some((item) => item.sessionId === id);

export const useSessionViewStore = create<SessionViewStore>((set, get) => {
  const patch = (id: string, change: Partial<SessionView>) =>
    set((state) => {
      const current = state.views[id];
      return current ? { views: { ...state.views, [id]: { ...current, ...change } } } : state;
    });

  const update = (id: string, change: (view: SessionView) => Partial<SessionView>) =>
    set((state) => {
      const current = state.views[id];
      return current
        ? { views: { ...state.views, [id]: { ...current, ...change(current) } } }
        : state;
    });

  /** Streams one turn into the view; always leaves the view idle and consistent. */
  const drive = async (
    id: string,
    handle: SessionHandle,
    localId: string,
    prompt: string,
    attachments: readonly UserAttachment[],
  ) => {
    if (useConnectionStore.getState().status !== 'ready') {
      update(id, (view) => ({
        items: failPendingUser(view.items, localId),
        turnActive: false,
        workingState: 'idle',
      }));
      return;
    }
    let unsubscribe = () => {};
    const lost = new Promise<'lost'>((resolve) => {
      unsubscribe = useConnectionStore.subscribe((state) => {
        if (state.status !== 'ready') resolve('lost');
      });
    });
    let stoppedByDaemon = false;
    let connectionLost: boolean;
    let failedResult: Parameters<typeof appendTurnFailure>[2] | undefined;
    try {
      const outcome = await runTurn(
        handle,
        prompt,
        (event) => {
          if (event.type === 'working_state') {
            update(id, () => ({ workingState: event.state }));
          } else if (event.type === 'token_usage') {
            update(id, () => ({ usage: event.usage }));
          } else {
            if (event.type === 'user') dequeue(id, event.message.id);
            if (event.type === 'result' && event.interrupted) stoppedByDaemon = true;
            if (event.type === 'result' && !event.success) failedResult = event;
            update(id, (view) => ({ items: [...applyStreamEvent(view.items, event)] }));
          }
        },
        lost,
        toStreamOptions(attachments),
      );
      connectionLost = outcome === 'lost';
      update(id, (view) => {
        const ended = settleTurn(view.items);
        const explained = failedResult ? appendTurnFailure(ended, localId, failedResult) : ended;
        const settled = failPendingUser(explained, localId);
        return {
          items: stoppedByDaemon || view.stopRequested ? markStopped(settled) : settled,
          interrupted: outcome === 'lost',
        };
      });
    } catch (err) {
      const connectionDown = err instanceof DaemonClientError && err.kind === 'connection';
      connectionLost = connectionDown;
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      update(id, (view) => {
        const failed = failPendingUser(settleTurn(view.items), localId);
        return {
          items: connectionDown ? failed : appendError(failed, message),
          interrupted: connectionDown,
        };
      });
    } finally {
      unsubscribe();
      useInteractionStore.getState().expire({ sessionId: id });
      update(id, () => ({ turnActive: false, workingState: 'idle' }));
    }
    const stopped = stoppedByDaemon || Boolean(get().views[id]?.stopRequested);
    await settleQueue(id, handle, connectionLost ? 'forget' : stopped ? 'restore' : 'wait');
  };

  const enqueue = async (
    id: string,
    handle: SessionHandle,
    prompt: string,
    attachments: readonly UserAttachment[],
  ) => {
    try {
      const { requestId } = await handle.queueMessage(prompt, toStreamOptions(attachments));
      const view = get().views[id];
      // The echo may already have arrived: the message ran and must not be shown as queued.
      const ran = view?.items.some((item) => item.id === requestId);
      if (view && !ran) {
        patch(id, { queued: [...view.queued, { requestId, text: prompt, attachments }] });
        if (!view.turnActive) await settleQueue(id, handle, 'wait');
      }
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      update(id, (view) => ({ items: appendError(view.items, message) }));
      restoreText(id, [{ requestId: '', text: prompt, attachments }]);
    }
  };

  const dequeue = (id: string, requestId: string) =>
    update(id, (view) =>
      view.queued.some((entry) => entry.requestId === requestId)
        ? { queued: view.queued.filter((entry) => entry.requestId !== requestId) }
        : {},
    );

  const restoreText = (id: string, entries: readonly QueuedMessage[]) => {
    if (entries.length === 0) return;
    const text = entries.map((entry) => entry.text).join('\n');
    restoreSeq += 1;
    const attachments = entries.flatMap((entry) => entry.attachments ?? []);
    update(id, () => ({ restored: { text, attachments, nonce: restoreSeq } }));
  };

  /**
   * Accounts for every message still queued when a turn ends, exactly once:
   * either the daemon stored it (it ran, the stored copy is the only one) or it
   * is dropped and handed back to the composer. `restore` is for a stopped turn
   * (the daemon discards its queue and stores nothing); `wait` gives a turn that
   * ended normally a moment to start the queued message; `forget` is for a lost
   * connection, where the reload from the daemon decides what exists.
   */
  const settleQueue = async (
    id: string,
    handle: SessionHandle,
    mode: 'restore' | 'wait' | 'forget',
  ) => {
    const attempts = mode === 'wait' ? QUEUE_SETTLE_ATTEMPTS : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const pending = get().views[id]?.queued ?? [];
      if (pending.length === 0) return;
      if (mode === 'forget') {
        patch(id, { queued: [] });
        return;
      }
      if (attempt > 0)
        await new Promise((resolve) => setTimeout(resolve, QUEUE_SETTLE_INTERVAL_MS));
      let stored: Set<string> | undefined;
      try {
        const page = await handle.getMessages({ limit: HISTORY_PAGE_SIZE });
        stored = new Set(page.messages.map((message) => message.id));
        const latest = get().views[id];
        if (latest && latest.handle === handle && !latest.turnActive) {
          bumpWindow(id);
          patch(id, {
            items: reconcileLocalItems(itemsFromMessages(page.messages), latest.items),
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
          });
        }
      } catch {
        // Nothing is known about the queue; the final attempt restores the text.
      }
      const current = get().views[id]?.queued ?? [];
      const unresolved = current.filter((entry) => !stored?.has(entry.requestId));
      patch(id, { queued: unresolved });
      if (unresolved.length === 0) return;
    }
    const left = get().views[id]?.queued ?? [];
    patch(id, { queued: [] });
    restoreText(id, left);
  };

  /**
   * Re-reads the latest page for a view that is already ready, picking up turns
   * other clients added. Older pages are dropped (the cursor restarts) so nothing
   * is duplicated; unsent local items stay. A view that started streaming while
   * the read was in flight is left alone.
   */
  const refreshLatest = async (id: string, handle: SessionHandle) => {
    try {
      const page = await handle.getMessages({ limit: HISTORY_PAGE_SIZE });
      const latest = get().views[id];
      if (!latest || latest.handle !== handle || latest.turnActive) return;
      bumpWindow(id);
      patch(id, {
        items: reconcileLocalItems(itemsFromMessages(page.messages), latest.items),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
    } catch {
      // The cached history stays visible; the next open retries.
    }
  };

  return {
    views: {},

    async open(connection, id, epoch) {
      const existing = get().views[id];
      if (existing && existing.epoch === epoch && existing.status !== 'error') {
        if (existing.status === 'ready' && existing.handle && !existing.turnActive) {
          await refreshLatest(id, existing.handle);
        }
        return;
      }
      set((state) => ({
        views: {
          ...state.views,
          [id]: { ...emptyView(id, epoch), items: existing?.items ?? [] },
        },
      }));
      const startedUnder = replacements;
      const current = () => startedUnder === replacements;
      try {
        const handle = await connection.resumeSession(id);
        // Stop pressed while the handle was unpublished is only a recorded intent.
        if (!current()) return;
        if (get().views[id]?.stopRequested) void handle.interrupt().catch(() => undefined);
        // Published before the history await so a later Stop dispatches immediately.
        patch(id, { handle });
        const page = await handle.getMessages({ limit: HISTORY_PAGE_SIZE });
        if (!current()) return;
        bumpWindow(id);
        patch(id, {
          status: 'ready',
          handle,
          items: reconcileLocalItems(itemsFromMessages(page.messages), existing?.items ?? []),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          modelId: handle.settings?.modelId,
          cwd: handle.cwd,
        });
      } catch (err) {
        if (!current()) return;
        patch(id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },

    async refreshOnResume() {
      const refreshes = Object.values(get().views).flatMap((view) =>
        view.status === 'ready' && view.handle && !view.turnActive
          ? [refreshLatest(view.id, view.handle)]
          : [],
      );
      await Promise.all(refreshes);
    },

    adopt(handle, epoch) {
      bumpWindow(handle.id);
      set((state) => ({
        views: {
          ...state.views,
          [handle.id]: {
            ...emptyView(handle.id, epoch),
            status: 'ready',
            handle,
            modelId: handle.settings?.modelId,
            cwd: handle.cwd,
          },
        },
      }));
    },

    async loadOlder(id) {
      const view = get().views[id];
      if (!view?.handle || !view.hasMore || view.loadingOlder) {
        return;
      }
      patch(id, { loadingOlder: true });
      const startedIn = historyWindow.get(id);
      try {
        const page = await view.handle.getMessages({
          limit: HISTORY_PAGE_SIZE,
          cursor: view.nextCursor,
        });
        if (startedIn !== historyWindow.get(id)) {
          patch(id, { loadingOlder: false });
          return;
        }
        const latest = get().views[id];
        patch(id, {
          items: prependItems(latest?.items ?? [], itemsFromMessages(page.messages)),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          loadingOlder: false,
        });
      } catch (err) {
        patch(id, {
          loadingOlder: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async send(id, text, attachments = []) {
      const view = get().views[id];
      const prompt = text.trim();
      // A late history response would overwrite the new bubble or resurrect a delivered one.
      if (!view?.handle || view.status === 'loading' || prompt === '' || hasPending(id)) {
        return;
      }
      if (view.turnActive) {
        await enqueue(id, view.handle, prompt, attachments);
        return;
      }
      localSeq += 1;
      const localId = `local-${localSeq}`;
      patch(id, {
        items: addPendingUser(view.items, localId, prompt, attachments),
        turnActive: true,
        workingState: 'thinking',
        interrupted: false,
        stopRequested: false,
      });
      useInteractionStore.getState().dismissExpired(id);
      await drive(id, view.handle, localId, prompt, attachments);
    },

    async retry(id, itemId) {
      const view = get().views[id];
      const failed = view?.items.find((item) => item.id === itemId && item.kind === 'user');
      if (
        !view?.handle ||
        view.status === 'loading' ||
        view.turnActive ||
        hasPending(id) ||
        failed?.kind !== 'user'
      ) {
        return;
      }
      patch(id, { items: removeItem(view.items, itemId) });
      await get().send(id, failed.text, failed.attachments);
    },

    async cancelQueued(id, requestId) {
      const handle = get().views[id]?.handle;
      if (!handle) return;
      try {
        await handle.cancelQueued(requestId);
      } catch (err) {
        // The message may have just started running; its echo then clears the queue entry.
        const message = redactSecrets(err instanceof Error ? err.message : String(err));
        update(id, (view) => ({ items: appendError(view.items, message) }));
        return;
      }
      dequeue(id, requestId);
    },

    consumeRestored(id, nonce) {
      update(id, (view) => (view.restored?.nonce === nonce ? { restored: undefined } : {}));
    },

    markDenied(id, tools) {
      update(id, (view) => ({ items: markToolsDenied(view.items, tools) }));
    },

    async follow(id) {
      const started = get().views[id];
      if (!started?.handle || started.turnActive) return;
      const handle = started.handle;
      let connectionLost = false;
      patch(id, { turnActive: true, workingState: 'thinking', stopRequested: false });
      try {
        for (let attempt = 0; attempt < FOLLOW_ATTEMPTS; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, FOLLOW_INTERVAL_MS));
          const view = get().views[id];
          if (!view) break;
          if (useConnectionStore.getState().status !== 'ready') {
            connectionLost = true;
            break;
          }
          if (view.stopRequested) break;
          if (useInteractionStore.getState().pending.some((item) => item.sessionId === id))
            continue;
          const page = await handle.getMessages({ limit: HISTORY_PAGE_SIZE });
          const items = reconcileLocalItems(itemsFromMessages(page.messages), view.items);
          patch(id, { items });
          const last = items.at(-1);
          if (
            last?.kind === 'assistant' &&
            !items.some((item) => item.kind === 'tool' && item.status === 'running')
          )
            break;
        }
      } catch {
        // The next open reloads the history; a failed poll needs no extra state.
      } finally {
        update(id, (view) => ({
          turnActive: false,
          workingState: 'idle',
          items: view.stopRequested ? markStopped(view.items) : view.items,
        }));
      }
      const stopped = Boolean(get().views[id]?.stopRequested);
      await settleQueue(id, handle, connectionLost ? 'forget' : stopped ? 'restore' : 'wait');
    },

    async interrupt(id) {
      patch(id, { stopRequested: true });
      useInteractionStore.getState().expire({ sessionId: id });
      try {
        await get().views[id]?.handle?.interrupt();
      } catch {
        // The turn's own stream reports the outcome; a failed interrupt needs no extra state.
      }
    },

    reset() {
      set({ views: {} });
    },
  };
});

/**
 * Cached transcripts belong to the daemon that served them: a replaced, forgotten
 * or signed-out connection must never show them under the next identity.
 */
useConnectionStore.subscribe((state, previous) => {
  if (state.connection !== previous.connection) {
    replacements += 1;
    historyWindow.clear();
    useSessionViewStore.getState().reset();
  }
});
