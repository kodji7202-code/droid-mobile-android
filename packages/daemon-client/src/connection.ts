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
import { classifyConnectFailure, isNonTransportFailure, versionWarningOf } from './classify';
import { cancelledAskUser } from './interactions';
import type { AskUserHandler, PermissionHandler } from './interactions';
import { AuthError, ConnectionError } from './errors';
import type { DaemonClientError, VersionMismatchWarning } from './errors';
import { toPage } from './paging';
import type { SessionMessagesPage } from './paging';
import { toModelSummary } from './settings';
import type { CreateSessionRequest, DefaultsPatch, ModelSummary } from './settings';
import type {
  DaemonCheckoutGitBranchRequestParams,
  DaemonCheckoutGitBranchResult,
  DaemonCreatePRRequestParams,
  DaemonCreatePRResult,
  DaemonGitCommitResult,
  DaemonGitPushResult,
  DaemonListGitBranchesResult,
  DaemonGetGitDiffResult,
  DaemonResolvePullRequestStatusesRequestParams,
  DaemonResolvePullRequestStatusesResult,
} from './git';
import { createMcpClient } from './mcp';
import { createPluginsClient } from './plugins';
import { createAutomationsClient } from './automations';
import { createCommandsClient } from './commands';
import { createCustomModelsClient } from './custom-models';
import { createSkillsClient } from './skills';
import type { McpClient } from './mcp';
import type { PluginsClient } from './plugins';
import type { AutomationsClient } from './automations';
import type { CommandsClient } from './commands';
import type { CustomModelsClient } from './custom-models';
import type { SkillsClient } from './skills';
import { probeDaemonIdentity } from './probe';
import { createMissionSource } from './mission-source';
import type { MissionSource } from './mission-source';
import { createTerminalClient } from './terminal-client';
import type { TerminalClient } from './terminal-client';
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

export type DirectoryValidation = Awaited<
  ReturnType<ConnectedDroid['workspace']['validateDirectory']>
>;
export type FolderTrust = Awaited<ReturnType<ConnectedDroid['workspace']['checkTrust']>>;
export type ChangeDirectoryResult = Awaited<
  ReturnType<ConnectedDroid['workspace']['changeDirectory']>
>;
export type WorkspaceFileContent = Awaited<
  ReturnType<ConnectedDroid['workspace']['getFileContent']>
>;
export type DefaultSettings = Awaited<ReturnType<ConnectedDroid['settings']['getDefaults']>>;

export interface DaemonConnectionOptions {
  url: string;
  apiKey: string;
  /** Overrides for the reconnect backoff (jittered exponential). */
  backoff?: Partial<BackoffOptions>;
  /** Interval of the liveness probe while ready; 0 disables it. */
  keepAliveMs?: number;
  /**
   * Answers daemon.request_permission. The returned promise decides when the
   * daemon's turn continues. Without a handler every request is cancelled.
   */
  permissionHandler?: PermissionHandler;
  /** Answers daemon.ask_user. Without a handler every request is cancelled. */
  askUserHandler?: AskUserHandler;
  /**
   * Called with the generation of every facade that is abandoned (transport
   * lost, replaced or disconnected), including attempts that never became
   * ready. Requests delivered by that facade can no longer be answered.
   */
  onFacadeLost?: (generation: number) => void;
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
  /**
   * Creates a terminal sidecar on its own socket (same url and key). The caller
   * owns it: connect(), then dispose() when done. Shells outlive the sidecar.
   */
  openTerminalClient(): TerminalClient;
  /** MCP server management on a scratch session owned by the client. */
  readonly mcp: McpClient;
  /** Skill listing and enablement on a scratch session owned by the client. */
  readonly skills: SkillsClient;
  /** Custom slash command discovery (read only). */
  readonly commands: CommandsClient;
  /** Plugin marketplaces and plugins on a scratch session owned by the client. */
  readonly plugins: PluginsClient;
  /** Bring-your-own-key models; the daemon keeps the keys and reports only a mask. */
  readonly customModels: CustomModelsClient;
  /** Scheduled automations: list, run descriptor, pause/resume and run history. */
  readonly automations: AutomationsClient;
  /** Mission snapshots and notifications of the sessions opened through this connection. */
  readonly missions: Pick<MissionSource, 'snapshot' | 'subscribe'>;

  /** Asks the daemon whether a working directory exists and is a directory. */
  validateDirectory(path: string): Promise<DirectoryValidation>;
  /** Asks the daemon whether sessions in the folder require a trust confirmation. */
  checkFolderTrust(path: string): Promise<FolderTrust>;
  /** Records the user's trust decision for the folder with the daemon. */
  trustFolder(path: string): Promise<void>;
  /** Changes the working directory of the given session. */
  changeDirectory(params: {
    sessionId: string;
    workingDirectory: string;
  }): Promise<ChangeDirectoryResult>;
  /** Lists files relative to the session's working directory. */
  listFiles(sessionId: string, showHidden?: boolean): Promise<string[]>;
  /** Searches for files matching a query under the session's working directory. */
  searchFiles(
    sessionId: string,
    query: string,
    maxResults?: number,
    showHidden?: boolean,
  ): Promise<string[]>;
  /** Retrieves content and metadata of a file under the session's working directory. */
  getFileContent(params: {
    sessionId: string;
    filePath: string;
    metadataOnly?: boolean;
    encoding?: 'utf8' | 'base64';
  }): Promise<WorkspaceFileContent>;
  /** Fetches git status and unified diff for the session working directory. */
  getGitDiff(params: {
    sessionId: string;
    baseBranch?: string;
    statsOnly?: boolean;
  }): Promise<DaemonGetGitDiffResult>;
  /** Lists local and origin branches of the repository at `cwd`. */
  listGitBranches(cwd: string): Promise<DaemonListGitBranchesResult>;
  /** Switches or creates a branch; the daemon may answer `needs_resolution`. */
  checkoutGitBranch(
    params: DaemonCheckoutGitBranchRequestParams,
  ): Promise<DaemonCheckoutGitBranchResult>;
  /** Commits the session's changes with the daemon's own file selection. */
  commitGitChanges(sessionId: string, message: string): Promise<DaemonGitCommitResult>;
  /** Pushes the session's current branch to its remote. */
  pushGitBranch(sessionId: string): Promise<DaemonGitPushResult>;
  /** Creates a pull request for the session's branch (needs a GitHub remote). */
  createPullRequest(params: DaemonCreatePRRequestParams): Promise<DaemonCreatePRResult>;
  /** Resolves pull request statuses for branches across sessions (at most 20 lookups per call). */
  resolvePullRequestStatuses(
    params: DaemonResolvePullRequestStatusesRequestParams,
  ): Promise<DaemonResolvePullRequestStatusesResult>;
  /** Daemon-wide default session settings (model, autonomy, ...). */
  getDefaultSettings(): Promise<DefaultSettings>;
  /** Writes daemon-wide defaults; resolves once the daemon acknowledged them. */
  updateDefaultSettings(patch: DefaultsPatch): Promise<void>;
  /** Every model the daemon offers (`models.list`). */
  listModels(): Promise<ModelSummary[]>;
  createSession(options: CreateSessionRequest): Promise<SessionHandle>;
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

/**
 * Facade ids are unique across every connection in the process: onFacadeLost
 * consumers expire interactions by id, so two connections must never share one.
 */
let facadeSequence = 0;
const nextFacadeId = (): number => ++facadeSequence;

const DEFAULT_PAGE_LIMIT = 50;
const RECONNECT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_KEEP_ALIVE_MS = 10_000;
const TRUST_VISIBLE_POLL_MS = 150;
const TRUST_VISIBLE_CAP_MS = 3_000;

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
  /** Outlives facades: a reconnect resumes sessions into the same mission stores. */
  const missions = createMissionSource();

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
    // Invalidate any in-flight attempt even when no facade is adopted yet, so a
    // pending authentication cannot adopt its droid after the teardown.
    const abandoned = droidToken;
    droidToken = nextFacadeId();
    options.onFacadeLost?.(abandoned);
    const droid = currentDroid;
    currentDroid = null;
    if (!droid) return;
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
    const token = (droidToken = nextFacadeId());
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
      missions.attach(droid);
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
      if (token !== droidToken || disposed || currentDroid !== droid) {
        if (currentDroid === droid) currentDroid = null;
        try {
          droid.disconnect();
        } catch {
          // stale droid teardown must never throw
        }
        throw new ConnectionError('Connection attempt was superseded.');
      }
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
        if (token !== droidToken) return;
        try {
          const session = await droid.sessions.resume(
            id,
            handlersFor(() => id, token),
          );
          if (token !== droidToken) return;
          handle.attach(session, token);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('liveness probe timed out')), timeoutMs);
    });
    try {
      await Promise.race([droid.sessions.list({ limit: 1 }), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
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
    const probeToken = droidToken;
    // A probe result only counts for the facade it was started against.
    const isCurrent = (): boolean =>
      !disposed && currentDroid === droid && probeToken === droidToken;
    if (err !== undefined) {
      const classified = classifyConnectFailure(err);
      if (classified.kind === 'auth') {
        lastFailure = classified;
        teardownDroid();
        emitStatus({ type: 'attempt-failed', failureKind: 'auth' });
        return;
      }
    }
    if (!(await isAlive(droid)) && isCurrent()) {
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

  /** Per-session handlers that tell the app which session a request belongs to. */
  function handlersFor(getSessionId: () => string | undefined, generation: number) {
    const { permissionHandler, askUserHandler } = options;
    return {
      ...(permissionHandler
        ? {
            permissionHandler: async (request: Parameters<PermissionHandler>[1]) =>
              generation === droidToken
                ? permissionHandler(getSessionId() ?? '', request, generation)
                : 'cancel',
          }
        : {}),
      ...(askUserHandler
        ? {
            askUserHandler: async (request: Parameters<AskUserHandler>[1]) =>
              generation === droidToken
                ? askUserHandler(getSessionId() ?? '', request, generation)
                : cancelledAskUser(),
          }
        : {}),
    };
  }

  /**
   * Classifies a failed facade call. A version-related failure becomes a
   * non-blocking warning; neither it, a cancellation nor an application error
   * is a transport problem, so none of them may trigger a reconnect.
   */
  function reportFailure(err: unknown): { error: DaemonClientError; transport: boolean } {
    const warning = versionWarningOf(err);
    if (warning) emitWarning(warning);
    const error = classifyConnectFailure(err);
    return {
      error,
      transport: error.kind === 'connection' && !warning && !isNonTransportFailure(err),
    };
  }

  /** Wraps a facade call, converting SDK failures into classified errors. */
  async function mapSdkError<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      const { error, transport } = reportFailure(err);
      if (transport) void handlePossibleDisconnect();
      throw error;
    }
  }

  function reattachSession(sessionId: string): Promise<ConnectedDroidSession> {
    const droid = requireDroid();
    const token = droidToken;
    return mapSdkError(async () => {
      const session = await droid.sessions.resume(
        sessionId,
        handlersFor(() => sessionId, token),
      );
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

  // The daemon acknowledges trust_folder before change_working_directory can see the new entry, so
  // callers that act right after trusting wait until the entry is visible (or the cap passes).
  async function waitUntilTrustVisible(path: string): Promise<void> {
    const droid = requireDroid();
    const deadline = Date.now() + TRUST_VISIBLE_CAP_MS;
    for (;;) {
      try {
        const state = await droid.workspace.checkTrust(path);
        if (state.isTrusted && !state.promptRequired) return;
      } catch {
        // The probe only shortens the wait; the caller's own request reports real failures.
      }
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, TRUST_VISIBLE_POLL_MS));
    }
  }

  const host: SessionHost = {
    currentDroidToken: () => droidToken,
    reportFailure,
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
    getContextBreakdownById: (sessionId) =>
      mapSdkError(() => requireDroid().sessions.getContextBreakdown(sessionId)),
    getRewindInfoById: (sessionId, messageId) =>
      mapSdkError(() => requireDroid().sessions.getRewindInfo(sessionId, messageId)),
    deleteQueuedById: async (sessionId, requestId) => {
      await mapSdkError(() =>
        requireDroid().sessions.resolveQueuedMessage(sessionId, {
          requestId,
          action: 'delete',
        } as Parameters<ReturnType<typeof requireDroid>['sessions']['resolveQueuedMessage']>[1]),
      );
    },
    changeDirectory: (sessionId, workingDirectory) =>
      mapSdkError(async () => {
        const result = await requireDroid().workspace.changeDirectory({
          sessionId,
          workingDirectory,
        });
        const handle = handles.get(sessionId);
        if (handle) {
          handle.setCwd(result.resolvedPath);
        }
        return result;
      }),
    listFiles: (sessionId, showHidden) =>
      mapSdkError(() => requireDroid().workspace.listFiles(sessionId, showHidden)),
    searchFiles: (sessionId, query, maxResults, showHidden) =>
      mapSdkError(() =>
        requireDroid().workspace.searchFiles(sessionId, query, maxResults, showHidden),
      ),
    getFileContent: (params) => mapSdkError(() => requireDroid().workspace.getFileContent(params)),
    getGitDiff: (sessionId, options) =>
      mapSdkError(() =>
        requireDroid().git.getDiff({
          sessionId,
          ...(options?.baseBranch ? { baseBranch: options.baseBranch } : {}),
          ...(options?.statsOnly !== undefined ? { statsOnly: options.statsOnly } : {}),
        }),
      ),
    resolvePullRequestStatuses: (params) =>
      mapSdkError(() => requireDroid().git.resolvePullRequestStatuses(params)),
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
    openTerminalClient: () => createTerminalClient({ url, apiKey }),
    mcp: createMcpClient({
      droid: requireDroid,
      generation: () => droidToken,
      run: mapSdkError,
    }),
    skills: createSkillsClient({
      droid: requireDroid,
      generation: () => droidToken,
      run: mapSdkError,
    }),
    commands: createCommandsClient({
      droid: requireDroid,
      generation: () => droidToken,
      run: mapSdkError,
    }),
    plugins: createPluginsClient({
      droid: requireDroid,
      generation: () => droidToken,
      run: mapSdkError,
    }),
    customModels: createCustomModelsClient({
      droid: requireDroid,
      generation: () => droidToken,
      run: mapSdkError,
    }),
    automations: createAutomationsClient({
      droid: requireDroid,
      generation: () => droidToken,
      run: mapSdkError,
    }),
    missions: { snapshot: missions.snapshot, subscribe: missions.subscribe },

    validateDirectory: (path) =>
      mapSdkError(() => requireDroid().workspace.validateDirectory(path)),
    checkFolderTrust: (path) => mapSdkError(() => requireDroid().workspace.checkTrust(path)),
    trustFolder: async (path) => {
      await mapSdkError(() => requireDroid().workspace.trust(path));
      await waitUntilTrustVisible(path);
    },
    changeDirectory: (params) => host.changeDirectory(params.sessionId, params.workingDirectory),
    listFiles: (sessionId, showHidden) => host.listFiles(sessionId, showHidden),
    searchFiles: (sessionId, query, maxResults, showHidden) =>
      host.searchFiles(sessionId, query, maxResults, showHidden),
    getFileContent: (params) => host.getFileContent(params),
    getGitDiff: (params) => host.getGitDiff(params.sessionId, params),
    listGitBranches: (cwd) => mapSdkError(() => requireDroid().git.listBranches(cwd)),
    checkoutGitBranch: (params) => mapSdkError(() => requireDroid().git.checkoutBranch(params)),
    commitGitChanges: (sessionId, message) =>
      mapSdkError(() => requireDroid().git.commit(sessionId, message)),
    pushGitBranch: (sessionId) => mapSdkError(() => requireDroid().git.push(sessionId)),
    createPullRequest: (params) => mapSdkError(() => requireDroid().git.createPullRequest(params)),
    resolvePullRequestStatuses: (params) => host.resolvePullRequestStatuses(params),
    getDefaultSettings: () => mapSdkError(() => requireDroid().settings.getDefaults()),
    updateDefaultSettings: async (patch) => {
      await mapSdkError(() =>
        requireDroid().settings.updateDefaults(
          patch as Parameters<ConnectedDroid['settings']['updateDefaults']>[0],
        ),
      );
    },
    listModels: async () => {
      const models = await mapSdkError(() => requireDroid().models.list());
      return models.map(toModelSummary);
    },

    async createSession(createOptions) {
      const droid = requireDroid();
      const token = droidToken;
      let createdId: string | undefined = createOptions.sessionId;
      const session = await mapSdkError(() =>
        droid.sessions.create({
          // String literals and the SDK's string enums share runtime values.
          ...(createOptions as CreateDaemonSessionOptions),
          ...handlersFor(() => createdId, token),
        }),
      );
      createdId = session.id;
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
