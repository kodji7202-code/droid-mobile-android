/**
 * Reconnect integration test: kills and restarts a THROWAWAY daemon on port
 * 3105 (AGENT/WS allocation) and verifies the adapter recovers on its own and
 * re-resumes opened sessions. Uses the real key; one minimal prompt to make
 * the probe session persist across the daemon restart; archived afterwards.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import type { DaemonConnection } from './connection';
import { removeScratchDir } from './integration-cleanup';

const DAEMON_PORT = 3105;
const DAEMON_URL = `ws://127.0.0.1:${DAEMON_PORT}`;
const DROID_EXE = process.env.DC_TEST_DROID_EXE ?? 'droid';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against a real daemon: load .env.local first.',
  );
}

let daemonPid: number | null = null;
let scratchDir: string | null = null;
let sessionToArchive: string | null = null;

function healthUrl(): string {
  return `http://127.0.0.1:${DAEMON_PORT}/health`;
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl());
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`throwaway daemon on ${DAEMON_PORT} did not become healthy within ${timeoutMs}ms`);
}

async function startThrowawayDaemon(): Promise<number> {
  const child = spawn(DROID_EXE, ['daemon', '--host', '127.0.0.1', '--port', String(DAEMON_PORT)], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const pid = child.pid ?? 0;
  daemonPid = pid;
  await waitForHealth(30_000);
  return pid;
}

async function killThrowawayDaemon(pid: number): Promise<void> {
  daemonPid = null;
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('exit', () => resolve());
    killer.on('error', () => resolve());
  });
  // Wait until the port stops answering.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(healthUrl(), { signal: AbortSignal.timeout(1000) });
      await new Promise((r) => setTimeout(r, 400));
    } catch {
      return;
    }
  }
  throw new Error(`throwaway daemon ${pid} still healthy after kill`);
}

afterAll(async () => {
  if (sessionToArchive && API_KEY) {
    const conn = createDaemonConnection({ url: 'ws://127.0.0.1:3101', apiKey: API_KEY });
    await conn.connect();
    await conn.archiveSession(sessionToArchive, { force: true }).catch((err: unknown) => {
      console.error('cleanup archive failed:', String(err).slice(0, 120));
    });
    conn.disconnect();
  }
  if (daemonPid !== null) await killThrowawayDaemon(daemonPid);
  if (scratchDir) await removeScratchDir(scratchDir);
});

describe('daemon connection reconnect (throwaway daemon 3105)', () => {
  it(
    'recovers ready -> reconnecting -> ready across a daemon kill/restart and re-resumes opened sessions',
    { timeout: 240_000 },
    async () => {
      await startThrowawayDaemon();
      scratchDir = await mkdtemp(join(tmpdir(), 'droidm-scratch-dc-re-'));

      const conn: DaemonConnection = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      const statuses: string[] = [];
      conn.onStatus((s) => statuses.push(s));
      await conn.connect();
      expect(conn.getStatus()).toBe('ready');

      // Open a session and give it one minimal turn so the daemon persists it.
      const handle = await conn.createSession({ cwd: scratchDir });
      sessionToArchive = handle.id;
      for await (const event of handle.stream('Reply with the single word OK')) {
        if (event.type === 'result') break;
      }
      const messagesBefore = await handle.getMessages({ limit: 10 });
      expect(messagesBefore.messages.length).toBeGreaterThan(0);

      // Kill the daemon: status must leave ready within 15 s, without caller action.
      const pid = daemonPid!;
      await killThrowawayDaemon(pid);
      const killTime = Date.now();
      while (conn.getStatus() === 'ready' && Date.now() - killTime < 15_000) {
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(conn.getStatus()).not.toBe('ready');

      // Manual retry while the daemon is still down: forces an attempt without
      // throwing and leaves the connection non-ready (no false ready).
      conn.retryNow();
      await new Promise((r) => setTimeout(r, 2000));
      expect(conn.getStatus()).not.toBe('ready');

      // Restart on the SAME port: the manual retry must cut the backoff short
      // and reach ready well inside the 60 s automatic budget.
      await startThrowawayDaemon();
      const restartTime = Date.now();
      conn.retryNow();
      while (conn.getStatus() !== 'ready' && Date.now() - restartTime < 20_000) {
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(conn.getStatus()).toBe('ready');
      expect(statuses).toContain('reconnecting');

      expect(conn.openedSessionIds()).toContain(handle.id);
      const after = await handle.getMessages({ limit: 10 });
      expect(after.messages.length).toBeGreaterThan(0);

      conn.disconnect();
      await killThrowawayDaemon(daemonPid!);
    },
  );
});
