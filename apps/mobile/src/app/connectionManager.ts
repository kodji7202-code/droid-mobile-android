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
import { PENDING_BRIDGE_SECRET_ID } from '../features/connect/pairing';

/** Thrown before any socket exists when the address breaks the transport policy. */
export class TransportPolicyError extends Error {
  readonly reason: 'malformed' | 'insecure';

  constructor(reason: 'malformed' | 'insecure') {
    super(`Daemon URL rejected: ${reason}`);
    this.name = 'TransportPolicyError';
    this.reason = reason;
  }
}

/** Thrown when a saved connection has no key in the secure store (web: after a reload). */
export class MissingKeyError extends Error {
  constructor() {
    super('No API key is stored for this connection');
    this.name = 'MissingKeyError';
  }
}

/** Thrown when a pending Add/Edit probe finishes after the user signed out. */
export class SignedOutError extends Error {
  constructor() {
    super('Signed out while the connection was being verified');
    this.name = 'SignedOutError';
  }
}

/** Thrown when a key could not be removed from secure storage; its metadata is kept for a retry. */
export class SecretDeleteError extends Error {
  constructor() {
    super('A stored key could not be removed from this device');
    this.name = 'SecretDeleteError';
  }
}

export interface ConnectionManagerState {
  connection: DaemonConnection | null;
  activeConnectionId: string | null;
  /** Persisted metadata (never keys) for Settings > Connection. */
  savedConnections: SavedConnection[];
  /** Persisted active marker; differs from the live connection after a web reload. */
  savedActiveId: string | null;
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
  addSavedConnection(connection: SavedConnection): void;
  updateSavedConnection(id: string, patch: Partial<Pick<SavedConnection, 'label' | 'url'>>): void;
  setActiveSavedConnection(id: string | null): void;
  removeSavedConnection(id: string): void;
  clearSavedConnections(): void;
  getSecureStore(): SecureStore;
  checkUrl(
    rawUrl: string,
  ): { ok: true; url: string } | { ok: false; reason: 'malformed' | 'insecure' };
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
  /**
   * Validates the address and key with a throwaway connection (same
   * authenticate check as onboarding) and only then saves the connection,
   * inactive. Rejects with the classified error and saves nothing otherwise.
   */
  addConnection(input: { label: string; url: string; apiKey: string }): Promise<SavedConnection>;
  /**
   * Makes the saved connection the single active one and reconnects. A target
   * that cannot be reached still becomes active (status shows the failure and
   * the user can switch away); only a missing key or policy violation rejects.
   */
  switchTo(id: string): Promise<void>;
  /**
   * Updates label/URL. A new key is validated against the (new) URL before
   * anything is saved; without one the stored key is kept and never read back
   * into the UI. Editing the active connection reconnects when it changed.
   */
  updateConnection(
    id: string,
    input: { label: string; url: string; apiKey?: string },
  ): Promise<void>;
  /** Deletes the connection and its key; forgetting the active one closes the socket. */
  forget(id: string): Promise<void>;
  /**
   * Full sign-out: closes the socket and deletes every saved connection, key,
   * pending bridge secret and metadata, leaving the empty Connect screen.
   */
  signOut(): Promise<void>;
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
  const initialSaved = deps.loadSavedConnections();
  let state: ConnectionManagerState = {
    connection: null,
    activeConnectionId: null,
    savedConnections: initialSaved.connections,
    savedActiveId: initialSaved.activeId,
    status: 'offline',
    readyEpoch: 0,
    lastErrorKind: null,
    versionWarning: null,
  };
  let unsubscribe: (() => void) | null = null;
  let pendingConnect: Promise<void> | null = null;
  // Bumped by signOut so probes started earlier can tell they were fenced off.
  let signOutEpoch = 0;
  const liveProbes = new Set<DaemonConnection>();

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

    const existing = deps
      .loadSavedConnections()
      .connections.find((entry) => entry.url === policy.url);
    const id = existing?.id ?? crypto.randomUUID();
    await deps.getSecureStore().setSecret(id, apiKey);
    deps.saveActiveConnection({
      id,
      label: existing?.label ?? labelFor(policy.url),
      url: policy.url,
    });
    emit({ activeConnectionId: id, ...snapshotSaved() });
  }

  function snapshotSaved(): Pick<ConnectionManagerState, 'savedConnections' | 'savedActiveId'> {
    const saved = deps.loadSavedConnections();
    return { savedConnections: saved.connections, savedActiveId: saved.activeId };
  }

  function checkedUrl(rawUrl: string): string {
    const policy = deps.checkUrl(rawUrl);
    if (!policy.ok) throw new TransportPolicyError(policy.reason);
    return policy.url;
  }

  async function validateCandidate(url: string, apiKey: string, epoch: number): Promise<void> {
    const probe = deps.createConnection({ url, apiKey });
    liveProbes.add(probe);
    try {
      await probe.connect();
      if (epoch !== signOutEpoch) throw new SignedOutError();
    } catch (error) {
      if (epoch !== signOutEpoch) throw new SignedOutError();
      throw error;
    } finally {
      liveProbes.delete(probe);
      try {
        probe.disconnect();
      } catch {
        // a probe that never connected may not close cleanly
      }
    }
  }

  async function addConnection(input: {
    label: string;
    url: string;
    apiKey: string;
  }): Promise<SavedConnection> {
    const url = checkedUrl(input.url);
    const epoch = signOutEpoch;
    await validateCandidate(url, input.apiKey, epoch);
    const entry: SavedConnection = {
      id: crypto.randomUUID(),
      label: input.label.trim() || labelFor(url),
      url,
    };
    await deps.getSecureStore().setSecret(entry.id, input.apiKey);
    if (epoch !== signOutEpoch) {
      await deps
        .getSecureStore()
        .deleteSecret(entry.id)
        .catch(() => undefined);
      throw new SignedOutError();
    }
    deps.addSavedConnection(entry);
    emit(snapshotSaved());
    return entry;
  }

  async function activate(id: string): Promise<void> {
    const entry = deps.loadSavedConnections().connections.find((candidate) => candidate.id === id);
    if (!entry) return;
    const url = checkedUrl(entry.url);
    const apiKey = await deps.getSecureStore().getSecret(id);
    if (!apiKey) throw new MissingKeyError();

    close();
    deps.setActiveSavedConnection(id);
    const connection = deps.createConnection({ url, apiKey });
    adopt(connection, id);
    emit(snapshotSaved());
    try {
      await connection.connect();
    } catch (error) {
      const kind = errorKindOf(error);
      emit({ lastErrorKind: kind });
      if (kind !== 'auth') retry();
    }
  }

  function switchTo(id: string): Promise<void> {
    if (state.connection && state.activeConnectionId === id) return Promise.resolve();
    return activate(id);
  }

  async function updateConnection(
    id: string,
    input: { label: string; url: string; apiKey?: string },
  ): Promise<void> {
    const entry = deps.loadSavedConnections().connections.find((candidate) => candidate.id === id);
    if (!entry) return;
    const url = checkedUrl(input.url);
    const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
    if (apiKey) {
      const epoch = signOutEpoch;
      await validateCandidate(url, apiKey, epoch);
      await deps.getSecureStore().setSecret(id, apiKey);
      if (epoch !== signOutEpoch) {
        await deps
          .getSecureStore()
          .deleteSecret(id)
          .catch(() => undefined);
        throw new SignedOutError();
      }
    }
    deps.updateSavedConnection(id, { label: input.label.trim() || labelFor(url), url });
    emit(snapshotSaved());
    const changed = apiKey !== null || url !== entry.url;
    if (changed && state.activeConnectionId === id) await activate(id);
  }

  async function deleteKey(id: string): Promise<void> {
    try {
      await deps.getSecureStore().deleteSecret(id);
    } catch {
      throw new SecretDeleteError();
    }
  }

  async function forget(id: string): Promise<void> {
    const saved = deps.loadSavedConnections();
    const wasActive = state.activeConnectionId === id || saved.activeId === id;
    let successor: string | null = null;
    // The Connect screen reads the saved list when it mounts (on close), so the
    // entry must be gone by then or the form would be prefilled with its URL.
    const dropAndClose = async (): Promise<void> => {
      await deleteKey(id);
      deps.removeSavedConnection(id);
      close();
    };
    if (wasActive) {
      for (const candidate of saved.connections) {
        if (candidate.id !== id && (await deps.getSecureStore().getSecret(candidate.id))) {
          successor = candidate.id;
          break;
        }
      }
      // Switching first keeps the shell mounted (no flash through the Connect screen).
      try {
        if (successor) await activate(successor);
        else await dropAndClose();
      } catch {
        successor = null;
        await dropAndClose();
      }
    }
    await deleteKey(id);
    deps.removeSavedConnection(id);
    emit({
      activeConnectionId: wasActive && !successor ? null : state.activeConnectionId,
      ...snapshotSaved(),
    });
  }
  async function signOut(): Promise<void> {
    const store = deps.getSecureStore();
    const ids = new Set(deps.loadSavedConnections().connections.map((entry) => entry.id));
    if (state.activeConnectionId) ids.add(state.activeConnectionId);
    signOutEpoch += 1;
    for (const probe of liveProbes) {
      try {
        probe.disconnect();
      } catch {
        // a probe that never connected may not close cleanly
      }
    }
    // Keys go first: metadata is the only record needed to retry a failed delete.
    const results = await Promise.allSettled(
      [...ids, PENDING_BRIDGE_SECRET_ID].map((id) => store.deleteSecret(id)),
    );
    if (results.some((result) => result.status === 'rejected')) throw new SecretDeleteError();
    // Metadata goes before close() so the Connect screen mounts with an empty form.
    deps.clearSavedConnections();
    close();
    emit({ activeConnectionId: null, ...snapshotSaved() });
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
    addConnection,
    switchTo,
    updateConnection,
    forget,
    signOut,
  };
}
