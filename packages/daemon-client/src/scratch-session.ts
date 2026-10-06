/**
 * Several daemon resources (mcp.*, plugins.*, marketplaces.*) need an open
 * session id even though they are not about a conversation. A client that
 * needs one owns a scratch session in the user's home folder: created on
 * first use, replaced after a reconnect, closed by release().
 */
import type { ConnectedDroid, ConnectedDroidSession } from '@factory/droid-sdk';
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

export function createHomeScratchSession(deps: ScratchSessionDeps): HomeScratchSession {
  let scratch: Promise<ScratchSession> | null = null;

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
        if (current) {
          const known = await current.catch(() => null);
          if (!known || known.generation !== deps.generation()) {
            scratch = null;
            current = null;
          }
        }
        if (!current) {
          current = open();
          scratch = current;
          current.catch(() => {
            if (scratch === current) scratch = null;
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
