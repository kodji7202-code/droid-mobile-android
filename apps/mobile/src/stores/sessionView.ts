import { create } from 'zustand';
import {
  DaemonClientError,
  addPendingUser,
  applyStreamEvent,
  failPendingUser,
  itemsFromMessages,
  localOnlyItems,
  prependItems,
  redactSecrets,
  removeItem,
  settleTurn,
  appendError,
} from '@droidmobile/daemon-client';
import type { DaemonConnection, SessionHandle, TranscriptItem } from '@droidmobile/daemon-client';
import { runTurn } from '../features/chat/runTurn';
import { useConnectionStore } from './connection';

/** Messages requested per getMessages page (the daemon returns them newest first). */
export const HISTORY_PAGE_SIZE = 50;

export type SessionViewStatus = 'loading' | 'ready' | 'error';

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
  send(id: string, text: string): Promise<void>;
  /** Resends a message that never reached the daemon. */
  retry(id: string, itemId: string): Promise<void>;
  interrupt(id: string): Promise<void>;
  reset(): void;
}

function emptyView(id: string, epoch: number): SessionView {
  return {
    id,
    status: 'loading',
    items: [],
    turnActive: false,
    workingState: 'idle',
    interrupted: false,
    hasMore: false,
    loadingOlder: false,
    epoch,
  };
}

let localSeq = 0;

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
  const drive = async (id: string, handle: SessionHandle, localId: string, prompt: string) => {
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
    try {
      const outcome = await runTurn(
        handle,
        prompt,
        (event) => {
          if (event.type === 'working_state') {
            update(id, () => ({ workingState: event.state }));
          } else {
            update(id, (view) => ({ items: [...applyStreamEvent(view.items, event)] }));
          }
        },
        lost,
      );
      update(id, (view) => ({
        items: failPendingUser(settleTurn(view.items), localId),
        interrupted: outcome === 'lost',
      }));
    } catch (err) {
      const connectionDown = err instanceof DaemonClientError && err.kind === 'connection';
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
      update(id, () => ({ turnActive: false, workingState: 'idle' }));
    }
  };

  return {
    views: {},

    async open(connection, id, epoch) {
      const existing = get().views[id];
      if (existing && existing.epoch === epoch && existing.status !== 'error') {
        return;
      }
      set((state) => ({
        views: {
          ...state.views,
          [id]: { ...emptyView(id, epoch), items: existing?.items ?? [] },
        },
      }));
      try {
        const handle = await connection.resumeSession(id);
        const page = await handle.getMessages({ limit: HISTORY_PAGE_SIZE });
        patch(id, {
          status: 'ready',
          handle,
          items: [...itemsFromMessages(page.messages), ...localOnlyItems(existing?.items ?? [])],
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          modelId: handle.settings?.modelId,
          cwd: handle.cwd,
        });
      } catch (err) {
        patch(id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },

    adopt(handle, epoch) {
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
      try {
        const page = await view.handle.getMessages({
          limit: HISTORY_PAGE_SIZE,
          cursor: view.nextCursor,
        });
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

    async send(id, text) {
      const view = get().views[id];
      const prompt = text.trim();
      if (!view?.handle || view.turnActive || prompt === '') {
        return;
      }
      localSeq += 1;
      const localId = `local-${localSeq}`;
      patch(id, {
        items: addPendingUser(view.items, localId, prompt),
        turnActive: true,
        workingState: 'thinking',
        interrupted: false,
      });
      await drive(id, view.handle, localId, prompt);
    },

    async retry(id, itemId) {
      const view = get().views[id];
      const failed = view?.items.find((item) => item.id === itemId && item.kind === 'user');
      if (!view?.handle || view.turnActive || failed?.kind !== 'user') {
        return;
      }
      patch(id, { items: removeItem(view.items, itemId) });
      await get().send(id, failed.text);
    },

    async interrupt(id) {
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
