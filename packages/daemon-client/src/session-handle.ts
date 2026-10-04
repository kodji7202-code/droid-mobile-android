/**
 * SessionHandle: the adapter's per-session wrapper (architecture.md 3.1).
 * Survives reconnects: after the connection re-resumes opened sessions, the
 * same handle delegates to the new underlying SDK session; if a call hits a
 * stale attachment, the next call re-resumes on the current connection.
 */
import type {
  ConnectedDroidSession,
  ForkSessionOptions,
  RewindSessionParams,
  UpdateSessionSettingsOptions,
} from '@factory/droid-sdk';
import type { NormalizedEvent } from './normalize';
import { normalizeStreamEvent } from './normalize';
import { classifyConnectFailure } from './classify';
import type { SessionMessagesPage } from './paging';

/** Stream option shape of the facade's session.stream (SDK type not re-exported). */
type FacadeStreamOptions = NonNullable<Parameters<ConnectedDroidSession['stream']>[1]>;

export interface StreamOptions {
  images?: FacadeStreamOptions['images'];
  files?: FacadeStreamOptions['files'];
  outputFormat?: FacadeStreamOptions['outputFormat'];
  abortSignal?: FacadeStreamOptions['abortSignal'];
}

type FacadeForkResult = Awaited<ReturnType<ConnectedDroidSession['fork']>>;
type FacadeCompactResult = Awaited<ReturnType<ConnectedDroidSession['compact']>>;
type FacadeRewindResult = Awaited<ReturnType<ConnectedDroidSession['rewind']>>;

/** Minimal view of the owning connection that the handle needs. */
export interface SessionHost {
  /** Monotonic token of the current underlying connection. */
  currentDroidToken(): number;
  /** Re-resumes the session on the current connection and attaches the handle. */
  reattachSession(sessionId: string): Promise<ConnectedDroidSession>;
  /** Asks the connection to verify the transport and recover if it is down. */
  onConnectionLost(): void;
  getMessagesPage(sessionId: string, options?: { limit?: number; cursor?: string }): Promise<SessionMessagesPage>;
  updateSettingsById(sessionId: string, params: UpdateSessionSettingsOptions): Promise<void>;
  archiveById(sessionId: string, options?: { force?: boolean }): Promise<void>;
}

export class SessionHandle {
  constructor(
    readonly id: string,
    private readonly host: SessionHost,
  ) {}

  private underlying: ConnectedDroidSession | undefined;
  private attachedDroidToken = -1;

  /** @internal Swaps the underlying session after a (re)attach. */
  attach(session: ConnectedDroidSession, droidToken: number): void {
    this.underlying = session;
    this.attachedDroidToken = droidToken;
  }

  /** Token of the underlying connection this handle is attached to (-1 = none). */
  attachedToken(): number {
    return this.attachedDroidToken;
  }

  /** @internal Forces the next call to re-resume. */
  markSuspect(): void {
    this.underlying = undefined;
  }

  private async resolveSession(): Promise<ConnectedDroidSession> {
    if (this.underlying && this.attachedDroidToken === this.host.currentDroidToken()) {
      return this.underlying;
    }
    this.underlying = undefined;
    return this.host.reattachSession(this.id);
  }

  private async withSession<T>(op: (session: ConnectedDroidSession) => Promise<T>): Promise<T> {
    let session: ConnectedDroidSession;
    try {
      session = await this.resolveSession();
    } catch (err) {
      throw classifyConnectFailure(err);
    }
    try {
      return await op(session);
    } catch (err) {
      const classified = classifyConnectFailure(err);
      if (classified.kind === 'connection') {
        // The transport may have dropped underneath us; force a re-resume on
        // the next call and let the connection recover itself.
        this.markSuspect();
        this.host.onConnectionLost();
      }
      throw classified;
    }
  }

  /** Normalized async-iterable of the turn's events (partial deltas included). */
  async *stream(prompt: string, options?: StreamOptions): AsyncGenerator<NormalizedEvent, void, undefined> {
    let session: ConnectedDroidSession;
    try {
      session = await this.resolveSession();
    } catch (err) {
      throw classifyConnectFailure(err);
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
      const classified = classifyConnectFailure(err);
      if (classified.kind === 'connection') {
        this.markSuspect();
        this.host.onConnectionLost();
      }
      throw classified;
    }
  }

  interrupt(): Promise<void> {
    return this.withSession((s) => s.interrupt());
  }

  updateSettings(params: UpdateSessionSettingsOptions): Promise<void> {
    return this.host.updateSettingsById(this.id, params);
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
        throw classifyConnectFailure(err);
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
      throw classifyConnectFailure(err);
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
