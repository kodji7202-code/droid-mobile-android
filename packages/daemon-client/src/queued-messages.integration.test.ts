/**
 * Queued messages against the real daemon (3101): a message queued during a
 * turn runs exactly once after it, and a cancelled one never runs.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import type { SessionHandle } from './session-handle';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

const QUEUED = 'Reply with the single word OK';

async function userTextCount(handle: SessionHandle, text: string): Promise<number> {
  const { messages } = await handle.getMessages({ limit: 50 });
  return messages.filter(
    (message) =>
      message.role === 'user' &&
      message.content.some((block) => block.type === 'text' && block.text === text),
  ).length;
}

/** Starts a long turn and resolves once the daemon is streaming it. */
async function startCount(handle: SessionHandle) {
  const stream = handle.stream('Count from 1 to 200, one number per line');
  const events: string[] = [];
  const done = (async () => {
    for await (const event of stream) {
      if (event.type === 'user') events.push(event.message.id);
    }
  })();
  while (events.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  return { done, events };
}

describe('queued messages against the real daemon (3101)', () => {
  it(
    'runs a queued message exactly once after the turn and cancels another for good',
    {
      timeout: 180_000,
    },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      await conn.connect();
      const dir = await mkdtemp(join(tmpdir(), 'droidm-scratch-queue-'));
      try {
        await conn.trustFolder(dir);
        const handle = await conn.createSession({ cwd: dir });

        const kept = await startCount(handle);
        const { requestId } = await handle.queueMessage(QUEUED);
        await kept.done;
        expect(kept.events).toContain(requestId);
        expect(await userTextCount(handle, QUEUED)).toBe(1);

        const cancelled = await startCount(handle);
        const second = await handle.queueMessage('Reply with the word NO');
        await handle.cancelQueued(second.requestId);
        await cancelled.done;
        expect(cancelled.events).not.toContain(second.requestId);
        expect(await userTextCount(handle, 'Reply with the word NO')).toBe(0);

        await handle.archive({ force: true });
      } finally {
        conn.disconnect();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
