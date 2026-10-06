import { rm } from 'node:fs/promises';

/**
 * Removes a scratch directory used by an integration test. On Windows the
 * daemon can keep a handle on a session's cwd for a moment after the session
 * is archived, so removal retries and then tolerates a lingering EBUSY: a
 * leftover temp dir must not fail a test whose assertions already passed.
 */
export async function removeScratchDir(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
  }
}
