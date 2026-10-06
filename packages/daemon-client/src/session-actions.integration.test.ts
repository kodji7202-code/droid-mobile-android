/**
 * Fork, compact and rewind against the real daemon (3101): the first time
 * these RPCs run end to end in this project. Pins the result shapes the app
 * relies on (new session ids, removedCount, rewind info arrays).
 */
import { describe, expect, it } from 'vitest';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import type { SessionHandle } from './session-handle';
import { removeScratchDir } from './integration-cleanup';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function drain(handle: SessionHandle, prompt: string): Promise<void> {
  for await (const event of handle.stream(prompt)) {
    void event;
  }
}

describe('fork / compact / rewind against the real daemon (3101)', () => {
  it(
    'forks independently, reports compact removedCount and rewinds with file changes',
    { timeout: 300_000 },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      await conn.connect();
      const dir = await mkdtemp(join(tmpdir(), 'droidm-scratch-actions-'));
      const created: string[] = [];
      try {
        await conn.trustFolder(dir);
        const source = await conn.createSession({ cwd: dir });
        created.push(source.id);
        await source.applySettings({ autonomyLevel: 'high' });

        await drain(source, 'Create a file hello.txt containing hi, then reply done');
        await drain(source, 'Reply with the single word OK');
        expect(await exists(join(dir, 'hello.txt'))).toBe(true);

        const history = (await source.getMessages({ limit: 100 })).messages;
        const users = history.filter((m) => m.role === 'user');
        expect(users.length).toBeGreaterThanOrEqual(2);

        // Fork: new id, same messages, independent afterwards.
        const fork = await source.fork({ title: 'val-fork-probe' });
        created.push(fork.newSessionId);
        expect(fork.newSessionId).not.toBe(source.id);
        const forkHandle = await conn.resumeSession(fork.newSessionId);
        const forkHistory = (await forkHandle.getMessages({ limit: 100 })).messages;
        expect(forkHistory.length).toBe(history.length);
        await drain(forkHandle, 'Reply with the single word OK');
        expect((await source.getMessages({ limit: 100 })).messages.length).toBe(history.length);

        // Rewind info for the user message that preceded the file creation.
        const firstUser = users.find((m) =>
          m.content.some((b) => b.type === 'text' && b.text.includes('hello.txt')),
        )!;
        const info = await source.getRewindInfo(firstUser.id);
        expect(info.createdFiles.some((f) => f.filePath.endsWith('hello.txt'))).toBe(true);
        expect(Array.isArray(info.availableFiles)).toBe(true);
        expect(Array.isArray(info.evictedFiles)).toBe(true);

        const rewound = await source.rewind({
          messageId: firstUser.id,
          filesToRestore: info.availableFiles,
          filesToDelete: info.createdFiles,
          forkTitle: 'val-rewind-probe',
        });
        created.push(rewound.newSessionId);
        expect(rewound.newSessionId).not.toBe(source.id);
        expect(rewound.deletedCount).toBe(info.createdFiles.length);
        expect(rewound.failedDeleteCount).toBe(0);
        expect(await exists(join(dir, 'hello.txt'))).toBe(false);

        // Compact runs in place on daemon 0.232.0: the returned id is the compacted session's own.
        const compacted = await forkHandle.compact();
        created.push(compacted.newSessionId);
        expect(compacted.newSessionId).toBe(fork.newSessionId);
        expect(compacted.removedCount).toBeGreaterThan(0);
      } finally {
        for (const id of created) {
          await conn.archiveSession(id, { force: true }).catch(() => undefined);
        }
        await conn.disconnect();
        await removeScratchDir(dir);
      }
    },
  );
});
