/**
 * App-level connection manager on top of packages/daemon-client (feature
 * connection-manager-reconnect-offline).
 *
 * Responsibilities the adapter does not own:
 * - apply the transport policy before any socket exists;
 * - restore the saved active connection at launch (native: the key comes from
 *   secure storage) and keep the connection object when the daemon is down, so
 *   the shell shows an offline state instead of a blank screen;
 * - mirror the daemon-client status plus a `readyEpoch` that data screens can
 *   use to refetch after a reconnect;
 * - expose the manual retry control (forces an immediate reconnect attempt);
 * - surface non-blocking protocol-version warnings.
 *
 * The manager is dependency-injected so its logic is unit-testable without a
 * daemon; the zustand store (stores/connection.ts) wires the real pieces.
 */
import type {
  ConnectionStatus,
  DaemonConnection,
  DaemonErrorKind,
  VersionMismatchWarning,
} from '@droidmobile/daemon-client';
import type { SavedConnection } from '../platform/savedConnections';
import type { SecureStore } from '../platform/secureStore';

/** Thrown before any socket exists when the address breaks the transport policy. */
export class TransportPolicyError extends Error {
  readonly reason: 'malformed' | 'insecure';

  constructor(reason: 'malformed' | 'insecure') {
    super(`Daemon URL rejected: ${reason}`);
    this.name = 'TransportPolicyError';
    this.reason = reason;
  }
}

export interface ConnectionManagerState {
  connection: DaemonConnection | null;
  activeConnectionId: string | null;
  /** Mirrors the active daemon-client connection status. */
  status: ConnectionStatus;
  /** Increments on every transition into `ready` (initial connect and reconnects). */
  readyEpoch: number;
  /** Kind of the last failure that made the connection non-ready (for messages). */
  lastErrorKind: DaemonErrorKind | null;
  /** Last non-blocking protocol-version warning; consumed by the notifier UI. */
  versionWarning: VersionMismatchWarning | null;
}

export interface ConnectionManagerDeps {
  createConnection(options: { url: string; apiKey: string }): DaemonConnection;
  loadSavedConnections(): { activeId: string | null; connections: SavedConnection[] };
  saveActiveConnection(connection: SavedConnection): void;
  getSecureStore(): SecureStore;
  checkUrl(rawUrl: string): { ok: true; url: string } | { ok: false; reason: 'malformed' | 'insecure' };
  onChange(state: ConnectionManagerState): void;
}

export interface ConnectionManager {
  getState(): ConnectionManagerState;
  /** Onboarding path: dials the entered URL/key and saves them on success. */
  connect(url: string, apiKey: string): Promise<void>;
  /**
   * Launch path: adopts the saved active connection when its key is available
   * and starts dialling in the background. Resolves once the decision was made
   * (a connection exists, or the user must enter a key on the Connect screen).
   */
  restore(): Promise<void>;
  /** Manual retry: forces an immediate attempt, or restores when nothing is loaded. */
  retry(): void;
  /** Tears the current connection down (if any) and returns to offline. */
  close(): void;
  clearVersionWarning(): void;
}

const ERROR_KINDS: readonly DaemonErrorKind[] = [
  'auth',
  'connection',
  'protocol',
  'method-unavailable',
  'unknown',
];

function errorKindOf(error: unknown): DaemonErrorKind | null {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return ERROR_KINDS.includes(kind as DaemonErrorKind) ? (kind as DaemonErrorKind) : null;
}

function labelFor(url: string): string {
  return new URL(url).host;
}

export function createConnectionManager(deps: ConnectionManagerDeps): ConnectionManager {
  let state: ConnectionManagerState = {
    connection: null,
    activeConnectionId: null,
    status: 'offline',
    readyEpoch: 0,
    lastErrorKind: null,
    versionWarning: null,
  };
  let unsubscribe: (() => void) | null = null;
  let pendingConnect: Promise<void> | null = null;

  function emit(next: Partial<ConnectionManagerState>): void {
    state = { ...state, ...next };
    deps.onChange(state);
  }

  function detachListeners(): void {
    unsubscribe?.();
    unsubscribe = null;
  }

  function attach(connection: DaemonConnection): void {
    detachListeners();
    const unsubscribeStatus = connection.onStatus((status) => {
      // The listener fires immediately; only a real transition into ready
      // bumps the epoch (so ready -> reconnecting -> ready counts once).
      const reachedReady = status === 'ready' && state.status !== 'ready';
      emit(reachedReady ? { status, readyEpoch: state.readyEpoch + 1 } : { status });
    });
    const unsubscribeWarning = connection.onWarning((warning) => {
      emit({ versionWarning: warning });
    });
    unsubscribe = () => {
      unsubscribeStatus();
      unsubscribeWarning();
    };
  }

  function adopt(connection: DaemonConnection, activeConnectionId: string | null): void {
    attach(connection);
    emit({
      connection,
      activeConnectionId,
      status: connection.getStatus(),
      lastErrorKind: null,
    });
  }

  function close(): void {
    const { connection } = state;
    detachListeners();
    if (connection) {
      try {
        connection.disconnect();
      } catch {
        // closing a broken connection must never throw
      }
    }
    emit({ connection: null, status: 'offline', lastErrorKind: null, versionWarning: null });
  }

  async function connectInternal(url: string, apiKey: string): Promise<void> {
    const policy = deps.checkUrl(url);
    if (!policy.ok) throw new TransportPolicyError(policy.reason);

    close();
    const connection = deps.createConnection({ url: policy.url, apiKey });
    adopt(connection, null);
    try {
      await connection.connect();
    } catch (error) {
      detachListeners();
      emit({ connection: null, status: 'offline', lastErrorKind: errorKindOf(error) });
      throw error;
    }

    const existing = deps.loadSavedConnections().connections.find((entry) => entry.url === policy.url);
    const id = existing?.id ?? crypto.randomUUID();
    await deps.getSecureStore().setSecret(id, apiKey);
    deps.saveActiveConnection({ id, label: existing?.label ?? labelFor(policy.url), url: policy.url });
    emit({ activeConnectionId: id });
  }

  function connect(url: string, apiKey: string): Promise<void> {
    // Concurrent submits (double tap) share one attempt.
    pendingConnect ??= connectInternal(url, apiKey).finally(() => {
      pendingConnect = null;
    });
    return pendingConnect;
  }

  async function restore(): Promise<void> {
    if (state.connection) return;
    const saved = deps.loadSavedConnections();
    const active = saved.connections.find((entry) => entry.id === saved.activeId);
    if (!active) return;
    const policy = deps.checkUrl(active.url);
    if (!policy.ok) return;
    const apiKey = await deps.getSecureStore().getSecret(active.id);
    if (!apiKey || state.connection) return;

    const connection = deps.createConnection({ url: policy.url, apiKey });
    adopt(connection, active.id);
    void connection.connect().catch((error: unknown) => {
      // The shell stays usable while the daemon is down; keep trying in the
      // background unless the key itself was rejected (then a new key is
      // needed and hammering the daemon is pointless).
      if (errorKindOf(error) !== 'auth') retry();
    });
  }

  function retry(): void {
    if (state.connection) {
      state.connection.retryNow();
      return;
    }
    void restore();
  }

  return {
    getState: () => state,
    connect,
    restore,
    retry,
    close,
    clearVersionWarning: () => emit({ versionWarning: null }),
  };
}
