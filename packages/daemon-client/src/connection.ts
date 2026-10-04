/**
 * createDaemonConnection: the adapter's connection core (architecture.md 3.1).
 *
 * - One WebSocket, one `daemon.authenticate`, over the SDK facade
 *   `connectToDaemon` (root entrypoint of @factory/droid-sdk 0.9.1).
 * - Status stream: connecting | authenticating | ready | reconnecting |
 *   offline | error.
 * - Reachability by WebSocket connect only; never fetch /health.
 * - Reconnect with jittered backoff once the connection was ready; opened
 *   sessions are re-resumed on the new connection without caller action.
 * - userId/orgId and the daemon-reported protocol version are read on demand
 *   via a one-shot identity probe (the facade does not expose the reply
 *   envelope, and the connect flow must stay a single WebSocket).
 * - Typed errors (AuthError/ConnectionError/ProtocolError/
 *   MethodUnavailableError); every message is secret-redacted.
 */
import { connectToDaemon } from '@factory/droid-sdk';
import type {
  ArchiveSessionOptions,
  ConnectedDroid,
  ConnectedDroidSession,
  CreateDaemonSessionOptions,
  DaemonSessionSummary,
  ListDaemonSessionsOptions,
  OpenedSessionSummary,
  SearchSessionsResult,
  SessionMessage,
  SessionsResource,
} from '@factory/droid-sdk';
import { backoffDelay } from './backoff';
import type { BackoffOptions } from './backoff';
import { classifyConnectFailure, versionWarningOf } from './classify';
import { AuthError, ConnectionError } from './errors';
import type { VersionMismatchWarning } from './errors';
import { toPage } from './paging';
import type { SessionMessagesPage } from './paging';
import { probeDaemonIdentity } from './probe';
import type { DaemonIdentity } from './probe';
import { INITIAL_CONNECTION_STATE, reduceConnectionState } from './status';
import type { ConnectionMachineEvent, ConnectionMachineState, ConnectionStatus } from './status';
import { SessionHandle } from './session-handle';
import type { SessionHost } from './session-handle';

/** Search params accepted by the facade's sessions.search (SDK type inferred). */
type FacadeSessionSearchParams = SessionsResource extends {
  search(params: infer P): unknown;
}
  ? P
  : never;

export type SessionSearchParams = FacadeSessionSearchParams;

export interface DaemonConnectionOptions {
  url: string;
  apiKey: string;
  /** Overrides for the reconnect backoff (jittered exponential). */
  backoff?: Partial<BackoffOptions>;
  /** Interval of the liveness probe while ready; 0 disables it. */
  keepAliveMs?: number;
}

/**
 * A daemon connection. Every session wrapper (and any other facade call)
 * requires a prior successful {@link DaemonConnection.connect}; without one
 * they reject with ConnectionError ("not ready"). Drops recover on their own
 * once the connection has been ready.
 */
export interface DaemonConnection {
  readonly url: string;
  getStatus(): ConnectionStatus;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  statusStream(): AsyncIterable<ConnectionStatus>;
  /** Resolves once ready; rejects with the classified error on failure. */
  whenReady(timeoutMs?: number): Promise<void>;
  /** Runs (or awaits) the initial connect attempt. Idempotent. */
  connect(): Promise<void>;
  /**
   * Forces an immediate reconnect attempt (the manual retry control): cuts a
   * pending backoff wait short and resets the backoff sequence. No-op while
   * ready or while an attempt is already in flight.
   */
  retryNow(): void;
  /** Stops reconnecting and closes the socket. connect() may be called again. */
  disconnect(): void;
  /**
   * Non-blocking protocol-version warnings emitted when a call fails with a
   * version-related error (the call still rejects; the warning is advisory).
   */
  onWarning(listener: (warning: VersionMismatchWarning) => void): () => void;
  /** On-demand identity probe (opens a second, short-lived WebSocket). */
  getDaemonIdentity(): Promise<DaemonIdentity>;
  /** Session ids opened through this connection and still tracked. */
  openedSessionIds(): readonly string[];

  createSession(options: CreateDaemonSessionOptions): Promise<SessionHandle>;
  resumeSession(sessionId: string): Promise<SessionHandle>;
  getSession(sessionId: string): SessionHandle | undefined;
  listSessions(options?: ListDaemonSessionsOptions): Promise<DaemonSessionSummary[]>;
  listOpenedSessions(): Promise<OpenedSessionSummary[]>;
  searchSessions(params: SessionSearchParams): Promise<SearchSessionsResult>;
  renameSession(sessionId: string, title: string): Promise<void>;
  archiveSession(sessionId: string, options?: ArchiveSessionOptions): Promise<void>;
  unarchiveSession(sessionId: string): Promise<void>;
  getMessagesPage(
    sessionId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<SessionMessagesPage>;
  /** Walks all pages (newest first) up to maxMessages. */
  listAllMessages(sessionId: string, options?: { maxMessages?: number }): Promise<SessionMessage[]>;
}

const DEFAULT_PAGE_LIMIT = 50;
const RECONNECT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_KEEP_ALIVE_MS = 10_000;

export function createDaemonConnection(options: DaemonConnectionOptions): DaemonConnection {
  const url = options.url;
  const apiKey = options.apiKey;
  const backoff: BackoffOptions = {
    initialMs: options.backoff?.initialMs ?? 500,
    maxMs: options.backoff?.maxMs ?? 15000,
    factor: options.backoff?.factor ?? 2,
    jitterFraction: options.backoff?.jitterFraction ?? 0.25,
  };

  const keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let probing = false;

  const listeners = new Set<(status: ConnectionStatus) => void>();
  const warningListeners = new Set<(warning: VersionMismatchWarning) => void>();
  const handles = new Map<string, SessionHandle>();

  let machine: ConnectionMachineState = { ...INITIAL_CONNECTION_STATE };
  let currentDroid: ConnectedDroid | null = null;
  let droidToken = 0;
  let connectPromise: Promise<void> | null = null;
  let reconnectLoopRunning = false;
  let reconnectGeneration = 0;
  let disposed = false;
  let lastFailure: Error | null = null;
  /** Set by retryNow(): the next reconnect wait is skipped and the backoff resets. */
  let forceRetry = false;
  /** Resolver of the sleep currently pending inside the reconnect loop. */
  let wakeReconnect: (() => void) | null = null;

  function emitStatus(event: ConnectionMachineEvent): void {
    machine = reduceConnectionState(machine, event);
    for (const listener of listeners) listener(machine.status);
  }

  function emitWarning(warning: VersionMismatchWarning): void {
    for (const listener of warningListeners) listener(warning);
  }

  /** Resolves a pending reconnect sleep early (manual retry / disconnect). */
  function wakeReconnectSleep(): void {
    const wake = wakeReconnect;
    wakeReconnect = null;
    wake?.();
  }

  /** Sleeps for the backoff delay unless retryNow()/disconnect() cut it short. */
  function sleepWithWake(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wakeReconnect = null;
        resolve();
      }, ms);
      wakeReconnect = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /**
   * An idle TCP socket stays "open" after the network goes away (airplane mode,
   * Wi-Fi loss) because no RST ever arrives, so liveness is probed periodically.
   */
  function startKeepAlive(): void {
    stopKeepAlive();
    if (keepAliveMs <= 0) return;
    keepAliveTimer = setInterval(() => {
      if (probing || !currentDroid || machine.status !== 'ready') return;
      probing = true;
      void handlePossibleDisconnect().finally(() => {
        probing = false;
      });
    }, keepAliveMs);
  }

  function stopKeepAlive(): void {
    if (keepAliveTimer !== null) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  function teardownDroid(): void {
    stopKeepAlive();
    const droid = currentDroid;
    currentDroid = null;
    if (!droid) return;
    // Invalidate any in-flight attempt so it cannot adopt its fresh droid
    // after the teardown (disconnect during connect).
    droidToken += 1;
    try {
      droid.disconnect();
    } catch {
      // disconnecting a broken droid must never throw
    }
  }

  /**
   * One connect attempt: status transitions and the facade connectToDaemon.
   * Rejects with a classified error; never retries by itself.
   */
  async function runAttempt(): Promise<void> {
    const token = ++droidToken;
    emitStatus({ type: 'attempt-start' });
    emitStatus({ type: 'auth-start' });
    lastFailure = null;
    try {
      const droid = await connectToDaemon({
        url,
        auth: { apiKey },
        onAuthenticationError: (err) => {
          if (token !== droidToken) return;
          lastFailure = classifyConnectFailure(err);
        },
        onError: (err) => {
          if (token !== droidToken) return;
          void handlePossibleDisconnect(err);
        },
      });
      if (token !== droidToken) {
        // A newer attempt or a disconnect superseded this one.
        try {
          droid.disconnect();
        } catch {
          // stale droid teardown must never throw
        }
        throw new ConnectionError('Connection attempt was superseded.');
      }
      currentDroid = droid;
      await rebindOpenedSessions(droid, token);
      emitStatus({ type: 'ready' });
      startKeepAlive();
    } catch (err) {
      const classified = classifyConnectFailure(err);
      lastFailure = classified;
      if (!disposed) {
        emitStatus({
          type: 'attempt-failed',
          failureKind: classified.kind === 'auth' ? 'auth' : 'transient',
        });
      }
      throw classified;
    }
  }

  /** Re-resumes every opened session on the fresh connection. */
  async function rebindOpenedSessions(droid: ConnectedDroid, token: number): Promise<void> {
    for (const [id, handle] of handles) {
      let attached = false;
      for (let retry = 0; retry < 2 && !attached; retry += 1) {
        try {
          handle.attach(await droid.sessions.resume(id), token);
          attached = true;
        } catch {
          // The daemon may still be warming up right after a restart; one
          // retry before dropping the session.
        }
      }
      if (!attached) handles.delete(id);
    }
  }

  async function isAlive(droid: ConnectedDroid, timeoutMs = 5000): Promise<boolean> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('liveness probe timed out')), timeoutMs);
    });
    try {
      await Promise.race([droid.sessions.list({ limit: 1 }), timeout]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Called when the SDK reports an error or a wrapper call fails: if the
   * connection was ready, verify liveness and start the reconnect loop when
   * the transport is really down (the SDK's internal reconnect gives up
   * after a few attempts and only then emits an error).
   */
  async function handlePossibleDisconnect(err?: unknown): Promise<void> {
    if (disposed || !machine.everReady || machine.status === 'error') return;
    if (!currentDroid) {
      startReconnectLoop();
      return;
    }
    const droid = currentDroid;
    if (err !== undefined) {
      const classified = classifyConnectFailure(err);
      if (classified.kind === 'auth') {
        lastFailure = classified;
        teardownDroid();
        emitStatus({ type: 'attempt-failed', failureKind: 'auth' });
        return;
      }
    }
    if (!(await isAlive(droid))) {
      lastFailure = new ConnectionError('The daemon connection was lost.');
      teardownDroid();
      emitStatus({ type: 'transport-lost' });
      startReconnectLoop();
    }
  }

  function startReconnectLoop(): void {
    if (reconnectLoopRunning || disposed) return;
    reconnectLoopRunning = true;
    const generation = ++reconnectGeneration;
    void (async () => {
      let attempt = 0;
      try {
        while (!disposed && !currentDroid) {
          attempt += 1;
          try {
            await runAttempt();
            return;
          } catch (err) {
            if (generation !== reconnectGeneration) return;
            const classified =
              err instanceof Error && err instanceof AuthError ? err : classifyConnectFailure(err);
            if (classified instanceof AuthError) {
              lastFailure = classified;
              return; // status error; the loop stops until connect() is called again
            }
            const skipWait = forceRetry;
            if (skipWait) {
              forceRetry = false;
              attempt = 0;
            }
            await sleepWithWake(skipWait ? 0 : backoffDelay(attempt, backoff));
          }
        }
      } finally {
        reconnectLoopRunning = false;
      }
    })();
  }

  /**
   * Manual retry: attempts again immediately instead of waiting for the
   * jittered backoff (the loop then continues normally if it fails again).
   */
  function retryNow(): void {
    if (currentDroid || connectPromise) return; // connected or already dialling
    disposed = false;
    forceRetry = true;
    if (reconnectLoopRunning) {
      wakeReconnectSleep();
      return;
    }
    startReconnectLoop();
  }

  async function connect(): Promise<void> {
    if (connectPromise) return connectPromise;
    if (currentDroid) return;
    if (reconnectLoopRunning) {
      // A drop is already being recovered; ride along.
      await whenReady(RECONNECT_READY_TIMEOUT_MS);
      return;
    }
    disposed = false;
    const attempt = (async () => {
      await runAttempt();
    })();
    connectPromise = attempt;
    try {
      await attempt;
    } finally {
      connectPromise = null;
    }
  }

  function whenReady(timeoutMs = 15_000): Promise<void> {
    if (machine.status === 'ready') return Promise.resolve();
    if (machine.status === 'error' && lastFailure) return Promise.reject(lastFailure);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new ConnectionError(`The daemon connection did not become ready within ${timeoutMs}ms.`),
        );
      }, timeoutMs);
      const unsubscribe = onStatus((status) => {
        if (status === 'ready') {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        } else if (status === 'error' && lastFailure) {
          clearTimeout(timer);
          unsubscribe();
          reject(lastFailure);
        }
      });
    });
  }

  function onStatus(listener: (status: ConnectionStatus) => void): () => void {
    listeners.add(listener);
    listener(machine.status);
    return () => listeners.delete(listener);
  }

  function disconnect(): void {
    disposed = true;
    reconnectGeneration += 1;
    wakeReconnectSleep();
    teardownDroid();
    emitStatus({ type: 'disconnected' });
  }

  function requireDroid(): ConnectedDroid {
    if (!currentDroid) {
      throw new ConnectionError('The daemon connection is not ready.');
    }
    return currentDroid;
  }

  /** Wraps a facade call, converting SDK failures into classified errors. */
  async function mapSdkError<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      // A version-related failure is surfaced as a non-blocking warning; it is
      // not a transport problem, so it must not trigger a reconnect.
      const warning = versionWarningOf(err);
      if (warning) emitWarning(warning);
      const classified = classifyConnectFailure(err);
      if (classified.kind === 'connection' && !warning) void handlePossibleDisconnect();
      throw classified;
    }
  }

  function reattachSession(sessionId: string): Promise<ConnectedDroidSession> {
    const droid = requireDroid();
    const token = droidToken;
    return mapSdkError(async () => {
      const session = await droid.sessions.resume(sessionId);
      const existing = handles.get(sessionId);
      if (existing) {
        existing.attach(session, token);
        return session;
      }
      const handle = new SessionHandle(sessionId, host);
      handle.attach(session, token);
      handles.set(sessionId, handle);
      return session;
    });
  }

  const host: SessionHost = {
    currentDroidToken: () => droidToken,
    reattachSession: (sessionId) => reattachSession(sessionId),
    onConnectionLost: () => {
      void handlePossibleDisconnect();
    },
    getMessagesPage: (sessionId, pageOptions) =>
      mapSdkError(async () => {
        const droid = requireDroid();
        const limit = pageOptions?.limit ?? DEFAULT_PAGE_LIMIT;
        const messages = await droid.sessions.getMessages(sessionId, {
          limit,
          ...(pageOptions?.cursor ? { cursor: pageOptions.cursor } : {}),
        });
        return toPage(messages, limit);
      }),
    updateSettingsById: async (sessionId, params) => {
      await mapSdkError(() => requireDroid().sessions.updateSettings(sessionId, params));
    },
    archiveById: async (sessionId, archiveOptions) => {
      await mapSdkError(() => requireDroid().sessions.archive(sessionId, archiveOptions));
    },
  };

  const connection: DaemonConnection = {
    url,
    getStatus: () => machine.status,
    onStatus,
    statusStream,
    whenReady,
    connect,
    retryNow,
    disconnect,
    onWarning(listener) {
      warningListeners.add(listener);
      return () => warningListeners.delete(listener);
    },
    getDaemonIdentity: () => mapSdkError(() => probeDaemonIdentity(url, apiKey)),
    openedSessionIds: () => [...handles.keys()],

    async createSession(createOptions) {
      const droid = requireDroid();
      const token = droidToken;
      const session = await mapSdkError(() => droid.sessions.create(createOptions));
      const handle = new SessionHandle(session.id, host);
      handle.attach(session, token);
      handles.set(session.id, handle);
      return handle;
    },
    async resumeSession(sessionId) {
      const existing = handles.get(sessionId);
      if (existing && existing.attachedToken() === droidToken && currentDroid) return existing;
      await reattachSession(sessionId);
      return handles.get(sessionId)!;
    },
    getSession: (sessionId) => {
      const handle = handles.get(sessionId);
      return handle && handle.attachedToken() === droidToken && currentDroid ? handle : undefined;
    },
    listSessions: (listOptions) => mapSdkError(() => requireDroid().sessions.list(listOptions)),
    listOpenedSessions: () => mapSdkError(() => requireDroid().sessions.listOpened()),
    searchSessions: (params) => mapSdkError(() => requireDroid().sessions.search(params)),
    renameSession: async (sessionId, title) => {
      await mapSdkError(() => requireDroid().sessions.rename(sessionId, title));
    },
    archiveSession: async (sessionId, archiveOptions) => {
      await mapSdkError(() => requireDroid().sessions.archive(sessionId, archiveOptions));
    },
    unarchiveSession: async (sessionId) => {
      await mapSdkError(() => requireDroid().sessions.unarchive(sessionId));
    },
    getMessagesPage: (sessionId, pageOptions) => host.getMessagesPage(sessionId, pageOptions),
    async listAllMessages(sessionId, allOptions) {
      const maxMessages = allOptions?.maxMessages ?? 500;
      const all: SessionMessage[] = [];
      let cursor: string | undefined;
      do {
        const page = await host.getMessagesPage(sessionId, { limit: 100, cursor });
        all.push(...page.messages);
        cursor = page.nextCursor;
      } while (cursor && all.length < maxMessages);
      return all;
    },
  };

  function statusStream(): AsyncIterable<ConnectionStatus> {
    let done = false;
    const queue: ConnectionStatus[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = connection.onStatus((status) => {
      queue.push(status);
      const w = wake;
      wake = null;
      w?.();
    });
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ConnectionStatus>> {
            if (done) return { done: true, value: undefined };
            if (queue.length === 0) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
              if (done) return { done: true, value: undefined };
            }
            return { done: false, value: queue.shift()! };
          },
          return(): Promise<IteratorResult<ConnectionStatus>> {
            done = true;
            unsubscribe();
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
  }

  // No auto-connect: the caller (connection manager / connect screen) decides
  // when to open the socket, so a fresh page load never dials out on its own.
  return connection;
}
