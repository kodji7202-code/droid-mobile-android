import type { DaemonConnection } from '@droidmobile/daemon-client';

/** Newest sessions are enough: the session the daemon creates is the most recent one. */
const LIST_LIMIT = 50;
/** The contract allows 15 s from the choice; the last poll must still fit. */
export const NEW_SESSION_TIMEOUT_MS = 14_000;
export const NEW_SESSION_POLL_MS = 1000;

const sameDirectory = (a: string | undefined, b: string | undefined) =>
  a !== undefined &&
  b !== undefined &&
  a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

export async function knownSessionIds(connection: DaemonConnection): Promise<Set<string>> {
  const page = await connection.listSessions({ limit: LIST_LIMIT });
  return new Set(page.map((summary) => summary.id));
}

/**
 * The proceed_new_session_* answers make the daemon create a session but the
 * response carries no id, so the list is polled for an id that was not there
 * before and that shares the working directory.
 */
export async function waitForNewSession(options: {
  connection: DaemonConnection;
  known: ReadonlySet<string>;
  cwd: string | undefined;
  signal: AbortSignal;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<string | undefined> {
  const { connection, known, cwd, signal } = options;
  const deadline = Date.now() + (options.timeoutMs ?? NEW_SESSION_TIMEOUT_MS);
  while (!signal.aborted) {
    try {
      const page = await connection.listSessions({ limit: LIST_LIMIT });
      const created = page.find(
        (summary) => !known.has(summary.id) && sameDirectory(summary.cwd, cwd),
      );
      if (created) return created.id;
    } catch {
      // A failed read is retried until the deadline.
    }
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? NEW_SESSION_POLL_MS));
  }
  return undefined;
}
