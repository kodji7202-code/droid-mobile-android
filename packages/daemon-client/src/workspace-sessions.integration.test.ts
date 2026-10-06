/**
 * Integration tests for directory validation, folder trust, default settings
 * and session creation/resume, against the REAL daemon on 127.0.0.1:3101.
 * No prompts are sent: sessions created here stay empty (never persisted).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import { removeScratchDir } from './integration-cleanup';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

let scratchRoot: string | undefined;

afterAll(async () => {
  if (scratchRoot) await removeScratchDir(scratchRoot);
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

  it(
    'lists files, searches files, changes directory and gets file content',
    {
      timeout: 30_000,
    },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      await conn.connect();
      const dir1 = await scratch();
      const dir2 = await scratch();
      await conn.trustFolder(dir1);
      await conn.trustFolder(dir2);

      // Setup files in dir1
      await mkdir(join(dir1, 'src'));
      await writeFile(join(dir1, 'hello.txt'), 'hello world');
      await writeFile(join(dir1, 'src', 'hello-world.ts'), 'export const greeting = "hello";');
      await writeFile(join(dir1, 'other.md'), '# Documentation');
      await writeFile(join(dir1, '.hidden-note'), 'secret');

      // Setup files in dir2
      await writeFile(join(dir2, 'readme-2.txt'), 'second directory');

      const handle = await conn.createSession({ cwd: dir1 });
      expect(handle.cwd).toBe(dir1);

      // listFiles without hidden
      const filesWithoutHidden = await handle.listFiles(false);
      const normalizedWithoutHidden = filesWithoutHidden.map((f) => f.replace(/\\/g, '/')).sort();
      expect(normalizedWithoutHidden).toContain('hello.txt');
      expect(normalizedWithoutHidden).toContain('other.md');
      expect(normalizedWithoutHidden).toContain('src/hello-world.ts');
      expect(normalizedWithoutHidden).not.toContain('.hidden-note');

      // listFiles with hidden
      const filesWithHidden = await handle.listFiles(true);
      const normalizedWithHidden = filesWithHidden.map((f) => f.replace(/\\/g, '/')).sort();
      expect(normalizedWithHidden).toContain('.hidden-note');

      // searchFiles
      const searchHits = await handle.searchFiles('hello');
      const normalizedHits = searchHits.map((f) => f.replace(/\\/g, '/'));
      expect(normalizedHits.some((h) => h.includes('hello.txt'))).toBe(true);

      // getFileContent
      const fileContent = await handle.getFileContent({ filePath: 'hello.txt' });
      expect(fileContent.content).toBe('hello world');
      expect(fileContent.byteLength).toBe(11);

      // changeDirectory to dir2
      const changeRes = await handle.changeDirectory(dir2);
      expect(changeRes.resolvedPath.toLowerCase()).toBe(dir2.toLowerCase());
      expect(handle.cwd?.toLowerCase()).toBe(dir2.toLowerCase());

      // listFiles in dir2
      const dir2Files = await handle.listFiles(false);
      expect(dir2Files.map((f) => f.replace(/\\/g, '/'))).toEqual(['readme-2.txt']);

      conn.disconnect();
    },
  );
});
