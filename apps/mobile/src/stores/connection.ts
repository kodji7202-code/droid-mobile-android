import { create } from 'zustand';
import { createDaemonConnection } from '@droidmobile/daemon-client';
import type { ConnectionStatus, DaemonConnection } from '@droidmobile/daemon-client';
import { checkDaemonUrl } from '../features/connect/validation';
import { isDebugBuild } from '../platform/buildFlavor';
import { getSecureStore } from '../platform/secureStore';
import { loadSavedConnections, saveActiveConnection } from '../platform/savedConnections';

/** Thrown before any socket exists when the address breaks the transport policy. */
export class TransportPolicyError extends Error {
  readonly reason: 'malformed' | 'insecure';

  constructor(reason: 'malformed' | 'insecure') {
    super(`Daemon URL rejected: ${reason}`);
    this.name = 'TransportPolicyError';
    this.reason = reason;
  }
}

interface ConnectionStore {
  connection: DaemonConnection | null;
  activeConnectionId: string | null;
  /** Mirrors the active daemon-client connection status; offline until one exists. */
  status: ConnectionStatus;
  /**
   * Applies the transport policy, establishes a daemon connection (one
   * WebSocket, one authenticate frame) and mirrors its status. Only after a
   * successful authenticate are the key (secure store) and the non-secret
   * metadata (localStorage) saved. Concurrent calls share one attempt.
   * Rethrows the classified error and discards the failed connection.
   */
  connect(url: string, apiKey: string): Promise<void>;
  /** Tears the current connection down (if any) and returns to offline. */
  close(): void;
}

function labelFor(url: string): string {
  return new URL(url).host;
}

let pending: Promise<void> | null = null;

export const useConnectionStore = create<ConnectionStore>((set, get) => {
  async function establish(url: string, apiKey: string): Promise<void> {
    const policy = checkDaemonUrl(url, isDebugBuild());
    if (!policy.ok) throw new TransportPolicyError(policy.reason);

    get().close();
    const connection = createDaemonConnection({ url: policy.url, apiKey });
    const unsubscribe = connection.onStatus((status) => set({ status }));
    set({ connection, status: connection.getStatus() });
    try {
      await connection.connect();
    } catch (error) {
      unsubscribe();
      set({ connection: null, status: 'offline' });
      throw error;
    }

    const existing = loadSavedConnections().connections.find((entry) => entry.url === policy.url);
    const id = existing?.id ?? crypto.randomUUID();
    await getSecureStore().setSecret(id, apiKey);
    saveActiveConnection({ id, label: existing?.label ?? labelFor(policy.url), url: policy.url });
    set({ activeConnectionId: id });
  }

  return {
    connection: null,
    activeConnectionId: null,
    status: 'offline',
    connect: (url, apiKey) => {
      pending ??= establish(url, apiKey).finally(() => {
        pending = null;
      });
      return pending;
    },
    close: () => {
      const existing = get().connection;
      if (existing) {
        existing.disconnect();
      }
      set({ connection: null, status: 'offline' });
    },
  };
});
