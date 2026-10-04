/**
 * Integration tests for directory validation, folder trust, default settings
 * and session creation/resume, against the REAL daemon on 127.0.0.1:3101.
 * No prompts are sent: sessions created here stay empty (never persisted).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

let scratchRoot: string | undefined;

afterAll(async () => {
  if (scratchRoot) await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
});

async function scratch(): Promise<string> {
  scratchRoot ??= await mkdtemp(join(tmpdir(), 'droidm-scratch-ws-'));
  return mkdtemp(join(scratchRoot, 'trust-'));
}

describe('workspace and session creation (real daemon 3101)', () => {
  it('validates directories with the daemon texts', { timeout: 30_000 }, async () => {
    const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
    await conn.connect();
    const dir = await scratch();
    await mkdir(join(dir, 'files'));
    const file = join(dir, 'files', 'notes.txt');
    await writeFile(file, 'x');

    expect(await conn.validateDirectory('C:\\no-such-dir-9f3c')).toMatchObject({
      isValid: false,
      error: 'Directory not found',
    });
    expect(await conn.validateDirectory(file)).toMatchObject({
      isValid: false,
      error: 'Path is not a directory',
    });
    expect(await conn.validateDirectory(dir)).toMatchObject({ isValid: true });
    conn.disconnect();
  });

  it(
    'reports an untrusted folder, honours trust, and creates an empty session',
    {
      timeout: 30_000,
    },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      await conn.connect();
      const dir = await scratch();

      const before = await conn.checkFolderTrust(dir);
      expect(before.promptRequired).toBe(true);
      expect(before.isTrusted).toBe(false);
      await conn.trustFolder(dir);
      expect((await conn.checkFolderTrust(dir)).isTrusted).toBe(true);

      const defaults = await conn.getDefaultSettings();

      const handle = await conn.createSession({ cwd: dir });
      expect(handle.cwd).toBe(dir);
      // defaults.modelId is optional: an absent value means the daemon picks the model when
      // the session is created, and only the session settings report it.
      expect(typeof handle.settings?.modelId).toBe('string');
      expect(handle.settings?.modelId).toBe(defaults.modelId ?? handle.settings?.modelId);
      const page = await handle.getMessages({ limit: 10 });
      expect(page.messages).toEqual([]);

      // Zero-message sessions are not listed.
      const listed = await conn.listSessions({ limit: 100 });
      expect(listed.some((s) => s.id === handle.id)).toBe(false);
      conn.disconnect();
    },
  );
});
