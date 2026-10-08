/**
 * Integration test for the terminal sidecar against the REAL daemon on
 * 127.0.0.1:3101: create, echo, a second connection re-listing the shell with
 * its serialized state, exit code, and cleanup. No prompts are sent.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import type { TerminalEvent } from './terminal-client';
import { removeScratchDir } from './integration-cleanup';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start a test daemon with tools/dev/start-daemon.ps1.',
  );
}

let scratchDir: string | undefined;
afterAll(async () => {
  if (scratchDir) await removeScratchDir(scratchDir);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('terminal sidecar (real daemon 3101)', () => {
  it(
    'creates a shell, relists it from a new sidecar with state, and reports the exit code',
    { timeout: 60_000 },
    async () => {
      scratchDir = await mkdtemp(join(tmpdir(), 'droidm-term-'));
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      await conn.connect();
      const session = await conn.createSession({ cwd: scratchDir });
      const terminalId = `it-${Date.now()}`;

      const first = conn.openTerminalClient();
      let output = '';
      first.onEvent((e) => {
        if (e.type === 'data' && e.terminalId === terminalId) output += e.data;
      });
      await first.connect();
      expect(await first.list(session.id)).toEqual([]);
      await first.create(session.id, { terminalId, cols: 100, rows: 30, cwd: scratchDir });
      await sleep(1500);
      await first.write(session.id, terminalId, 'echo hi-123\r');
      await sleep(1500);
      expect(output).toContain('hi-123');
      first.dispose();

      const second = conn.openTerminalClient();
      const exits: TerminalEvent[] = [];
      second.onEvent((e) => {
        if (e.type === 'exit') exits.push(e);
      });
      await second.connect();
      const listed = await second.list(session.id);
      expect(listed.map((t) => t.id)).toEqual([terminalId]);
      expect(listed[0]!.state?.plainText).toContain('hi-123');
      expect(await second.list('no-such-session')).toEqual([]);

      await second.write(session.id, terminalId, 'exit 3\r');
      await sleep(2000);
      expect(exits).toMatchObject([{ terminalId, exitCode: 3 }]);
      expect(await second.list(session.id)).toEqual([]);
      second.dispose();

      await conn.archiveSession(session.id).catch(() => undefined);
      conn.disconnect();
    },
  );
});
