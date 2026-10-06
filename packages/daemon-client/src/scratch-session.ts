/**
 * Several daemon resources (mcp.*, plugins.*, marketplaces.*) need an open
 * session id even though they are not about a conversation. A client that
 * needs one owns a scratch session in the user's home folder: created on
 * first use, replaced after a reconnect, closed by release().
 */
import type { ConnectedDroid, ConnectedDroidSession } from '@factory/droid-sdk';
import { isNonTransportFailure } from './classify';
import { DaemonClientError } from './errors';

export interface ScratchSessionDeps {
  droid(): ConnectedDroid;
  /** Identity of the current facade; a different value means the socket was replaced. */
  generation(): number;
  /** Runs a facade call, converting SDK failures into classified errors. */
  run<T>(op: () => Promise<T>): Promise<T>;
}

export interface HomeScratchSession {
  /** Id of the live scratch session, opening one when needed. */
  id(): Promise<string>;
  /** Closes the scratch session; the next id() opens a new one. */
  release(): Promise<void>;
}

interface ScratchSession {
  id: string;
  generation: number;
  session: ConnectedDroidSession;
}

export interface HomeScratchSessionOptions {
  /**
   * True while daemon state is bound to the scratch session (an OAuth sign-in
   * the daemon cancels only through the session that started it). A replaced
   * socket then resumes the same session id instead of opening a new one.
   */
  keep?: () => boolean;
  /** Called when a kept session could not be resumed and was replaced. */
  onLost?: () => void;
}

export function createHomeScratchSession(
  deps: ScratchSessionDeps,
  options: HomeScratchSessionOptions = {},
): HomeScratchSession {
  let scratch: Promise<ScratchSession> | null = null;

  async function resume(previous: ScratchSession): Promise<ScratchSession> {
    const droid = deps.droid();
    const generation = deps.generation();
    try {
      const session = await droid.sessions.resume(previous.id);
      return { id: previous.id, generation, session };
    } catch (err) {
      if (!isNonTransportFailure(err)) throw err;
      options.onLost?.();
      return open();
    }
  }

  async function open(): Promise<ScratchSession> {
    const droid = deps.droid();
    const generation = deps.generation();
    const home = await droid.workspace.validateDirectory('~');
    if (!home.isValid || !home.resolvedPath) {
      throw new DaemonClientError('unknown', home.error ?? 'The daemon has no home folder.');
    }
    const session = await droid.sessions.create({ cwd: home.resolvedPath });
    return { id: session.id, generation, session };
  }

  return {
    id: () =>
      deps.run(async () => {
        let current = scratch;
        let stale: ScratchSession | null = null;
        if (current) {
          const known = await current.catch(() => null);
          if (!known || known.generation !== deps.generation()) {
            stale = known;
            scratch = null;
            current = null;
          }
        }
        if (!current) {
          const kept = stale !== null && options.keep?.() === true ? stale : null;
          const opening: Promise<ScratchSession> = kept ? resume(kept) : open();
          current = opening;
          scratch = opening;
          opening.catch(() => {
            // A resume that failed because the socket is down again must not forget the
            // session: the daemon still holds the sign-in bound to it.
            if (scratch === opening) scratch = kept ? Promise.resolve(kept) : null;
          });
        }
        return (await current).id;
      }),
    async release() {
      const current = scratch;
      scratch = null;
      if (!current) return;
      const known = await current.catch(() => null);
      if (!known || known.generation !== deps.generation()) return;
      await known.session.close().catch(() => undefined);
    },
  };
}

interface CwdScratchEntry {
  cwd: string | undefined;
  opening: Promise<ScratchSession>;
}

export interface CwdScratchSession {
  /** Id of a live scratch session whose cwd is `cwd` (the home folder when omitted). */
  id(cwd?: string): Promise<string>;
  /** Closes the scratch session; the next id() opens a new one. */
  release(): Promise<void>;
}

/**
 * Skills and commands are scoped to the cwd of an open session and a long-lived
 * session can report stale state, so the client owns one scratch session for
 * the folder it is asked about: replaced when the folder or the socket changes.
 */
export function createCwdScratchSession(deps: ScratchSessionDeps): CwdScratchSession {
  let scratch: CwdScratchEntry | null = null;

  async function open(cwd: string | undefined): Promise<ScratchSession> {
    const droid = deps.droid();
    const generation = deps.generation();
    let folder = cwd;
    if (folder === undefined) {
      const home = await droid.workspace.validateDirectory('~');
      if (!home.isValid || !home.resolvedPath) {
        throw new DaemonClientError('unknown', home.error ?? 'The daemon has no home folder.');
      }
      folder = home.resolvedPath;
    }
    const session = await droid.sessions.create({ cwd: folder });
    return { id: session.id, generation, session };
  }

  async function close(entry: CwdScratchEntry): Promise<void> {
    const known = await entry.opening.catch(() => null);
    if (!known || known.generation !== deps.generation()) return;
    await known.session.close().catch(() => undefined);
  }

  return {
    id: (cwd) =>
      deps.run(async () => {
        let current = scratch;
        if (current) {
          const known = await current.opening.catch(() => null);
          if (current.cwd !== cwd) {
            scratch = null;
            void close(current);
            current = null;
          } else if (!known || known.generation !== deps.generation()) {
            scratch = null;
            current = null;
          }
        }
        if (!current) {
          const entry: CwdScratchEntry = { cwd, opening: open(cwd) };
          current = entry;
          scratch = entry;
          entry.opening.catch(() => {
            if (scratch === entry) scratch = null;
          });
        }
        return (await current.opening).id;
      }),
    async release() {
      const current = scratch;
      scratch = null;
      if (current) await close(current);
    },
  };
}
