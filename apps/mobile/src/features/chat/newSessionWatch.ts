import type { DaemonConnection } from '@droidmobile/daemon-client';
import { MAX_PAGE_SIZE, mergeRows, nextCursor, toRow } from '../sessions/sessionsPaging';
import type { PageCursor, SessionRowData } from '../sessions/sessionsPaging';

/** Newest sessions are enough while polling: the new session is always the most recent one. */
const POLL_LIMIT = 50;
/** Bounds the pre-state read (10 000 sessions) so a broken cursor cannot loop forever. */
const MAX_PRE_STATE_PAGES = 100;
/** The contract allows 15 s from the choice; the last poll must still fit. */
export const NEW_SESSION_TIMEOUT_MS = 14_000;
export const NEW_SESSION_POLL_MS = 1000;

const sameDirectory = (a: string | undefined, b: string | undefined) =>
  a !== undefined &&
  b !== undefined &&
  a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

/** The autonomy level a proceed_new_session_* answer asks for; the plain option sets none. */
export function expectedAutonomy(value: string): string | undefined {
  const match = /^proceed_new_session_(low|medium|high)$/.exec(value);
  return match?.[1];
}

/**
 * Every existing session id. A partial snapshot would let an older session
 * pass as new, so the whole list is paged through before the answer is sent.
 */
export async function knownSessionIds(
  connection: DaemonConnection,
  maxPages = MAX_PRE_STATE_PAGES,
): Promise<Set<string>> {
  let rows: SessionRowData[] = [];
  let cursor: PageCursor | undefined;
  for (let index = 0; index < maxPages; index += 1) {
    const limit = cursor?.limit ?? MAX_PAGE_SIZE;
    const page = await connection.listSessions({
      limit,
      ...(cursor !== undefined ? { endBefore: cursor.endBefore } : {}),
    });
    const pageRows = page.map(toRow);
    rows = mergeRows(rows, pageRows);
    if (page.length < limit) return new Set(rows.map((row) => row.id));
    cursor = nextCursor(pageRows, cursor);
    if (cursor === undefined) break;
  }
  // An incomplete pre-state must not be used: an older session could pass as new.
  throw new Error('Session history could not be read completely');
}

/**
 * The proceed_new_session_* answers make the daemon create a session but the
 * response carries no id, so the list is polled for an id that was not in the
 * complete pre-state, that shares the working directory and whose settings
 * carry the requested autonomy.
 */
export async function waitForNewSession(options: {
  connection: DaemonConnection;
  known: ReadonlySet<string>;
  cwd: string | undefined;
  autonomy?: string;
  signal: AbortSignal;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<string | undefined> {
  const { connection, known, cwd, autonomy, signal } = options;
  const deadline = Date.now() + (options.timeoutMs ?? NEW_SESSION_TIMEOUT_MS);
  const rejected = new Set<string>();
  while (!signal.aborted) {
    try {
      const page = await connection.listSessions({ limit: POLL_LIMIT });
      for (const summary of page) {
        if (known.has(summary.id) || rejected.has(summary.id)) continue;
        if (!sameDirectory(summary.cwd, cwd)) continue;
        if (autonomy === undefined) return summary.id;
        const level = (await connection.resumeSession(summary.id)).settingsSnapshot?.autonomyLevel;
        if (level === autonomy) return summary.id;
        // A session whose settings are not readable yet is looked at again.
        if (level !== undefined) rejected.add(summary.id);
      }
    } catch {
      // A failed read is retried until the deadline.
    }
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? NEW_SESSION_POLL_MS));
  }
  return undefined;
}
