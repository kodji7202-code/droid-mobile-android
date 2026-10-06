import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes `contents` next to the target and renames it into place, so readers and a crash
 * never see a half-written file. The rename is retried because Windows briefly denies it
 * while antivirus or an indexer holds the destination open.
 */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tempPath, contents, { mode: 0o600 });
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(tempPath, filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 8 || !code || !RETRYABLE.has(code)) throw error;
        await sleep(15 * (attempt + 1));
      }
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
