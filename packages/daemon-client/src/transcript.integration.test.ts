/**
 * Streams one minimal real turn and checks that the live transcript equals the
 * transcript rebuilt from the daemon's stored messages (no duplicates, same text).
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import { applyStreamEvent, itemsFromMessages } from './transcript';
import type { TranscriptItem } from './transcript';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

describe('transcript against the real daemon (3101)', () => {
  it('live stream merge equals the stored history', { timeout: 120_000 }, async () => {
    const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
    await conn.connect();
    const dir = await mkdtemp(join(tmpdir(), 'droidm-scratch-transcript-'));
    try {
      await conn.trustFolder(dir);
      const handle = await conn.createSession({ cwd: dir });
      let live: readonly TranscriptItem[] = [];
      let sawDelta = false;
      for await (const event of handle.stream('Reply with the single word OK')) {
        if (event.type === 'assistant_text_delta') sawDelta = true;
        live = applyStreamEvent(live, event);
      }
      const stored = itemsFromMessages((await handle.getMessages({ limit: 50 })).messages);
      expect(sawDelta).toBe(true);
      expect(live.map((item) => item.id)).toEqual(stored.map((item) => item.id));
      expect(live.at(-1)).toMatchObject({ kind: 'assistant', text: 'OK', streaming: false });
      await handle.archive({ force: true });
    } finally {
      conn.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
