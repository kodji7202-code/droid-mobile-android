/**
 * SessionHandle: the adapter's per-session wrapper (architecture.md 3.1).
 * Survives reconnects: after the connection re-resumes opened sessions, the
 * same handle delegates to the new underlying SDK session; if a call hits a
 * stale attachment, the next call re-resumes on the current connection.
 */
import type {
  ConnectedDroidSession,
  ContextBreakdownResult,
  ForkSessionOptions,
  RewindSessionParams,
  SessionSettings,
  UpdateSessionSettingsOptions,
} from '@factory/droid-sdk';
import type { NormalizedEvent } from './normalize';
import { normalizeStreamEvent } from './normalize';
import { isNonTransportFailure } from './classify';
import type { DaemonClientError } from './errors';
import type { SessionMessagesPage } from './paging';
import { snapshotOf, toUpdateOptions } from './settings';
import type { SessionSettingsSnapshot, SettingsPatch } from './settings';

/** Stream option shape of the facade's session.stream (SDK type not re-exported). */
type FacadeStreamOptions = NonNullable<Parameters<ConnectedDroidSession['stream']>[1]>;

export interface StreamOptions {
  images?: FacadeStreamOptions['images'];
  files?: FacadeStreamOptions['files'];
  outputFormat?: FacadeStreamOptions['outputFormat'];
  abortSignal?: FacadeStreamOptions['abortSignal'];
}

/** The daemon's context-window breakdown for a session. */
export type ContextBreakdown = ContextBreakdownResult;

type FacadeForkResult = Awaited<ReturnType<ConnectedDroidSession['fork']>>;
type FacadeCompactResult = Awaited<ReturnType<ConnectedDroidSession['compact']>>;
type FacadeRewindResult = Awaited<ReturnType<ConnectedDroidSession['rewind']>>;

/** Minimal view of the owning connection that the handle needs. */
export interface SessionHost {
  /** Monotonic token of the current underlying connection. */
  currentDroidToken(): number;
  /** Re-resumes the session on the current connection and attaches the handle. */
  reattachSession(sessionId: string): Promise<ConnectedDroidSession>;
  /**
   * Maps a failed SDK call to a typed error, emitting the advisory version
   * warning when applicable. 	ransport is true only for a real connection loss
   * (never for cancellations, application errors or version mismatches).
   */
  reportFailure(err: unknown): { error: DaemonClientError; transport: boolean };
  /** Asks the connection to verify the transport and recover if it is down. */
  onConnectionLost(): void;
  getMessagesPage(
    sessionId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<SessionMessagesPage>;
  updateSettingsById(sessionId: string, params: UpdateSessionSettingsOptions): Promise<void>;
  archiveById(sessionId: string, options?: { force?: boolean }): Promise<void>;
  getContextBreakdownById(sessionId: string): Promise<ContextBreakdown>;
  /** Removes a queued message from the daemon's queue so it is never executed. */
  deleteQueuedById(sessionId: string, requestId: string): Promise<void>;
}

/**
 * The facade's stream() refuses to start while a turn runs, and its public
 * surface has no way to add a queued message. The controller underneath owns
 * the ddUserMessage call the daemon queues on; this is the one place that
 * reaches for it (pinned SDK 0.9.1), checked at runtime so a changed SDK fails
 * with a clear error instead of a TypeError.
 */
interface QueueingController {
  addUserMessage(
    sessionId: string,
    params: {
      messageId: string;
      text: string;
      images?: StreamOptions['images'];
      files?: StreamOptions['files'];
      queuePlacement: 'end_of_loop';
      userMessageSource: 'sdk';
    },
    requestId: string,
  ): Promise<unknown>;
}

function queueingController(session: ConnectedDroidSession): QueueingController {
  const controller = (session as unknown as { controller?: Partial<QueueingController> })
    .controller;
  if (!controller || typeof controller.addUserMessage !== 'function') {
    throw new Error('This SDK version cannot queue messages during a running turn.');
  }
  return controller as QueueingController;
}

export class SessionHandle {
  constructor(
    readonly id: string,
    private readonly host: SessionHost,
  ) {}

  private underlying: ConnectedDroidSession | undefined;
  private attachedDroidToken = -1;
  private lastSettings: Readonly<SessionSettings> | undefined;
  private lastCwd: string | undefined;
  private pendingDetach: Promise<void> | undefined;
  private accepted: { base: Readonly<SessionSettings>; patch: SettingsPatch } | undefined;

  /** @internal Swaps the underlying session after a (re)attach. */
  attach(session: ConnectedDroidSession, droidToken: number): void {
    this.underlying = session;
    this.attachedDroidToken = droidToken;
    this.lastSettings = session.settings;
    this.lastCwd = session.cwd;
  }

  /**
   * Current settings: the SDK session merges the daemon's settings_updated
   * notifications into its own copy, also between turns.
   */
  get settings(): Readonly<SessionSettings> | undefined {
    return this.underlying?.settings ?? this.lastSettings;
  }

  /**
   * Settings as the UI shows them: the daemon's view, with our own accepted
   * update on top until a newer daemon notification replaces the SDK copy.
   */
  get settingsSnapshot(): SessionSettingsSnapshot | undefined {
    const live = this.settings;
    if (!live) return undefined;
    const snapshot = snapshotOf(live);
    return this.accepted?.base === live ? { ...snapshot, ...this.accepted.patch } : snapshot;
  }

  /** Working directory the daemon reported for the session. */
  get cwd(): string | undefined {
    return this.lastCwd;
  }

  /** Token of the underlying connection this handle is attached to (-1 = none). */
  attachedToken(): number {
    return this.attachedDroidToken;
  }

  /**
   * @internal Forces the next call to re-resume. The SDK attachment is released
   * first: a facade that survived the liveness probe still holds it and would
   * reject the re-resume as already attached.
   */
  markSuspect(): void {
    const stale = this.underlying;
    this.underlying = undefined;
    if (!stale) return;
    this.pendingDetach = stale.detach().then(
      () => undefined,
      () => undefined,
    );
  }

  private async resolveSession(): Promise<ConnectedDroidSession> {
    if (this.underlying && this.attachedDroidToken === this.host.currentDroidToken()) {
      return this.underlying;
    }
    this.underlying = undefined;
    await this.pendingDetach;
    this.pendingDetach = undefined;
    return this.host.reattachSession(this.id);
  }

  private async withSession<T>(op: (session: ConnectedDroidSession) => Promise<T>): Promise<T> {
    let session: ConnectedDroidSession;
    try {
      session = await this.resolveSession();
    } catch (err) {
      throw this.host.reportFailure(err).error;
    }
    try {
      return await op(session);
    } catch (err) {
      throw this.failed(err);
    }
  }

  /** Normalized async-iterable of the turn's events (partial deltas included). */
  async *stream(
    prompt: string,
    options?: StreamOptions,
  ): AsyncGenerator<NormalizedEvent, void, undefined> {
    let session: ConnectedDroidSession;
    try {
      session = await this.resolveSession();
    } catch (err) {
      throw this.host.reportFailure(err).error;
    }
    try {
      const rawStream = session.stream(prompt, {
        includePartialMessages: true,
        images: options?.images,
        files: options?.files,
        outputFormat: options?.outputFormat,
        abortSignal: options?.abortSignal,
      });
      for await (const raw of rawStream) {
        yield normalizeStreamEvent(raw);
      }
    } catch (err) {
      if (options?.abortSignal?.aborted || isNonTransportFailure(err)) {
        throw this.host.reportFailure(err).error;
      }
      throw this.failed(err);
    }
  }

  /**
   * Queues a message behind the running turn (held until the agent loop ends,
   * then executed once). Resolves with the request id that identifies it in the
   * daemon's queue and, once processed, as the id of the stored user message.
   */
  queueMessage(
    text: string,
    options?: Pick<StreamOptions, 'images' | 'files'>,
  ): Promise<{ requestId: string }> {
    return this.withSession(async (session) => {
      const requestId = globalThis.crypto.randomUUID();
      await queueingController(session).addUserMessage(
        session.id,
        {
          messageId: requestId,
          text,
          images: options?.images,
          files: options?.files,
          queuePlacement: 'end_of_loop',
          userMessageSource: 'sdk',
        },
        requestId,
      );
      return { requestId };
    });
  }

  /** Deletes a queued message; the daemon will not execute it. */
  async cancelQueued(requestId: string): Promise<void> {
    try {
      await this.host.deleteQueuedById(this.id, requestId);
    } catch (err) {
      throw this.failed(err);
    }
  }

  /** Maps a failed call; only a real transport loss poisons the attachment. */
  private failed(err: unknown): DaemonClientError {
    const { error, transport } = this.host.reportFailure(err);
    if (transport) {
      // The transport may have dropped underneath us; force a re-resume on the
      // next call and let the connection recover itself.
      this.markSuspect();
      this.host.onConnectionLost();
    }
    return error;
  }

  interrupt(): Promise<void> {
    return this.withSession((s) => s.interrupt());
  }

  updateSettings(params: UpdateSessionSettingsOptions): Promise<void> {
    return this.host.updateSettingsById(this.id, params);
  }

  /** Persists a settings change; resolves only once the daemon accepted it. */
  async applySettings(patch: SettingsPatch): Promise<void> {
    const base = this.settings;
    await this.updateSettings(toUpdateOptions(patch));
    const live = this.settings;
    // A notification that already merged the change replaced the SDK copy.
    if (live && live === base) {
      this.accepted = {
        base: live,
        patch: { ...(this.accepted?.base === live ? this.accepted.patch : {}), ...patch },
      };
    }
  }

  rename(title: string): Promise<void> {
    return this.withSession(async (s) => {
      await s.rename(title);
    });
  }

  fork(options?: ForkSessionOptions): Promise<FacadeForkResult> {
    return this.withSession((s) => s.fork(options));
  }

  compact(customInstructions?: string): Promise<FacadeCompactResult> {
    return this.withSession((s) => s.compact(customInstructions));
  }

  rewind(params: RewindSessionParams): Promise<FacadeRewindResult> {
    return this.withSession((s) => s.rewind(params));
  }

  /** Token usage of the context window by category, straight from the daemon. */
  getContextBreakdown(): Promise<ContextBreakdown> {
    // The daemon only answers for a session it has loaded, so attach first.
    return this.withSession(() => this.host.getContextBreakdownById(this.id));
  }

  /** Hides the session; `force` archives it even while an agent turn runs. */
  archive(options?: { force?: boolean }): Promise<void> {
    return this.host.archiveById(this.id, options);
  }

  /** Stops receiving events; the session keeps running in the daemon. */
  async detach(): Promise<void> {
    const session = this.underlying;
    this.underlying = undefined;
    if (session) {
      try {
        await session.detach();
      } catch (err) {
        throw this.host.reportFailure(err).error;
      }
    }
  }

  /** Ends the session in the daemon, then detaches. */
  async close(): Promise<void> {
    const session = this.underlying;
    this.underlying = undefined;
    if (!session) return;
    try {
      await session.close();
    } catch (err) {
      throw this.host.reportFailure(err).error;
    }
  }

  /**
   * One page of history, newest first (daemon order). `nextCursor` is the
   * oldest message id of the page; pass it back as `cursor` for the next page.
   */
  getMessages(options?: { limit?: number; cursor?: string }): Promise<SessionMessagesPage> {
    return this.host.getMessagesPage(this.id, options);
  }
}
