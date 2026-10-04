import { create } from 'zustand';
import { createDaemonConnection } from '@droidmobile/daemon-client';
import type { ConnectionStatus, DaemonConnection } from '@droidmobile/daemon-client';

interface ConnectionStore {
  connection: DaemonConnection | null;
  /** Mirrors the active daemon-client connection status; offline until one exists. */
  status: ConnectionStatus;
  /**
   * Establishes a daemon connection (one WebSocket, one authenticate frame)
   * and mirrors its status into the store. Rethrows the classified error;
   * the failed connection is discarded so nothing is half-remembered.
   */
  connect(url: string, apiKey: string): Promise<void>;
  /** Tears the current connection down (if any) and returns to offline. */
  close(): void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connection: null,
  status: 'offline',
  connect: async (url, apiKey) => {
    get().close();
    const connection = createDaemonConnection({ url, apiKey });
    const unsubscribe = connection.onStatus((status) => set({ status }));
    set({ connection, status: connection.getStatus() });
    try {
      await connection.connect();
    } catch (error) {
      unsubscribe();
      set({ connection: null, status: 'offline' });
      throw error;
    }
  },
  close: () => {
    const existing = get().connection;
    if (existing) {
      existing.disconnect();
    }
    set({ connection: null, status: 'offline' });
  },
}));
