import { create } from 'zustand';
import type { DaemonConnection, SessionHandle, SessionMessage } from '@droidmobile/daemon-client';
import { prependPage } from '../features/session/history';

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
  /** Raw daemon messages, oldest first. */
  messages: SessionMessage[];
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
  reset(): void;
}

function emptyView(id: string, epoch: number): SessionView {
  return { id, status: 'loading', messages: [], hasMore: false, loadingOlder: false, epoch };
}

export const useSessionViewStore = create<SessionViewStore>((set, get) => {
  const patch = (id: string, change: Partial<SessionView>) =>
    set((state) => {
      const current = state.views[id];
      return current ? { views: { ...state.views, [id]: { ...current, ...change } } } : state;
    });

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
          [id]: { ...emptyView(id, epoch), messages: existing?.messages ?? [] },
        },
      }));
      try {
        const handle = await connection.resumeSession(id);
        const page = await handle.getMessages({ limit: HISTORY_PAGE_SIZE });
        patch(id, {
          status: 'ready',
          handle,
          messages: [...page.messages].reverse(),
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
          messages: prependPage(latest?.messages ?? [], page.messages),
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

    reset() {
      set({ views: {} });
    },
  };
});
