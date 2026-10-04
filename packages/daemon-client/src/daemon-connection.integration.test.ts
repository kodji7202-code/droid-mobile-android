/**
 * Integration tests for the daemon-client connection core, run against the
 * REAL droid daemon on 127.0.0.1:3101 (services.yaml: droid-daemon-test) with
 * the real key from .env.local (FACTORY_API_KEY). No mocks of the daemon.
 *
 * Real-credit discipline: prompts are the contract's minimal ones; every
 * session created here is archived at the end.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createDaemonConnection } from './connection';
import { AuthError, ConnectionError } from './errors';
import type { DaemonConnection } from './connection';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;
const PROBE_KEY = 'fk-invalid-validation-probe';
// Deliberately closed port from the validation contract (nothing listens).
const CLOSED_PORT_URL = 'ws://127.0.0.1:3199';

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

const createdSessionIds: string[] = [];
let scratchDir: string;

afterEach(async () => {
  // Archive what this file created (sessions that received a message).
  if (!createdSessionIds.length) return;
  const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
  await conn.connect();
  for (const id of createdSessionIds.splice(0)) {
    await conn.archiveSession(id, { force: true }).catch((err: unknown) => {
      console.error('cleanup archive failed:', String(err).slice(0, 120));
    });
  }
  conn.disconnect();
});

afterAll(async () => {
  if (scratchDir) await rmRF(scratchDir);
});

async function rmRF(path: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

async function freshScratch(): Promise<string> {
  scratchDir ??= await mkdtemp(join(tmpdir(), 'droidm-scratch-dc-'));
  return mkdtemp(join(scratchDir, 's-'));
}

function statusHistory(conn: DaemonConnection): string[] {
  const history: string[] = [];
  conn.onStatus((s) => history.push(s));
  return history;
}

const LONG = 60_000;

describe('daemon connection (real daemon 3101)', () => {
  it(
    'connects with the real key, reaches ready, and reports daemon identity on demand',
    { timeout: LONG },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      const history = statusHistory(conn);
      expect(conn.getStatus()).toBe('offline');
      await conn.connect();
      expect(conn.getStatus()).toBe('ready');
      expect(history).toContain('connecting');
      expect(history).toContain('authenticating');

      const identity = await conn.getDaemonIdentity();
      expect(identity.userId.length).toBeGreaterThan(0);
      expect(identity.orgId.length).toBeGreaterThan(0);
      expect(identity.daemonProtocolVersion).toMatch(/^\d+\.\d+\.\d+$/);
      conn.disconnect();
      expect(conn.getStatus()).toBe('offline');
    },
  );

  it(
    'rejects a wrong key with a key-specific AuthError and never leaks it',
    { timeout: LONG },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: PROBE_KEY });
      let failure: unknown;
      try {
        await conn.connect();
      } catch (err) {
        failure = err;
      }
      expect(failure).toBeInstanceOf(AuthError);
      const authError = failure as AuthError;
      expect(authError.message).toMatch(/api key/i);
      expect(authError.message).not.toContain('Internal error');
      expect(authError.message).not.toContain(PROBE_KEY);
      expect(authError.message).not.toContain(API_KEY);
      expect(conn.getStatus()).toBe('error');
      conn.disconnect();
    },
  );

  it(
    'rejects an unreachable endpoint with ConnectionError (distinct class) within 15s',
    { timeout: LONG },
    async () => {
      const conn = createDaemonConnection({ url: CLOSED_PORT_URL, apiKey: API_KEY });
      const started = Date.now();
      let failure: unknown;
      try {
        await conn.connect();
      } catch (err) {
        failure = err;
      }
      expect(failure).toBeInstanceOf(ConnectionError);
      expect(failure).not.toBeInstanceOf(AuthError);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(conn.getStatus()).toBe('offline');
      conn.disconnect();
    },
  );

  it(
    'rejects a non-daemon TCP endpoint with ConnectionError within 15s',
    { timeout: LONG },
    async () => {
      // A TCP listener that answers HTTP but is not a daemon WebSocket
      // (stand-in for any non-daemon endpoint such as the Vite server).
      const server = createServer((_req, res) => res.writeHead(404).end('not a daemon'));
      await new Promise<void>((resolve) => server.listen(3109, '127.0.0.1', resolve));
      try {
        const conn = createDaemonConnection({ url: 'ws://127.0.0.1:3109', apiKey: API_KEY });
        const started = Date.now();
        let failure: unknown;
        try {
          await conn.connect();
        } catch (err) {
          failure = err;
        }
        expect(failure).toBeInstanceOf(ConnectionError);
        expect(failure).not.toBeInstanceOf(AuthError);
        expect(Date.now() - started).toBeLessThan(15_000);
        conn.disconnect();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it(
    'pages through session messages without duplicates using derived cursors',
    { timeout: LONG },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      await conn.connect();
      const sessions = await conn.listSessions({ limit: 20 });
      // A small session keeps the 2-per-page walk short.
      const withMessages = sessions.find((s) => s.messageCount >= 2 && s.messageCount <= 10);
      expect(withMessages, 'the shared daemon should have small sessions').toBeTruthy();

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await conn.getMessagesPage(withMessages!.id, { limit: 2, cursor });
        seen.push(...page.messages.map((m) => m.id));
        cursor = page.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(20);
      } while (cursor && pages < 20);
      expect(seen.length).toBeGreaterThan(2);
      expect(new Set(seen).size).toBe(seen.length);
      conn.disconnect();
    },
  );

  it(
    'supports create / rename / getMessages / listOpened / archive / unarchive with zero messages',
    { timeout: LONG },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      await conn.connect();
      const cwd = await freshScratch();
      const handle = await conn.createSession({ cwd, title: 'val-dc-roundtrip' });
      createdSessionIds.push(handle.id);

      await handle.rename('val-dc-roundtrip-renamed');

      const page = await handle.getMessages({ limit: 10 });
      expect(page.messages).toEqual([]);
      expect(page.hasMore).toBe(false);

      // Zero-message sessions are absent from sessions.list; listOpened shows them.
      const openedIds = await conn.listOpenedSessions();
      expect(openedIds.some((s) => s.id === handle.id)).toBe(true);

      await conn.archiveSession(handle.id);
      await conn.unarchiveSession(handle.id);
      await handle.detach();
      conn.disconnect();
    },
  );

  it(
    'streams a minimal turn as normalized events ending in a result',
    { timeout: 120_000 },
    async () => {
      const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
      await conn.connect();
      const cwd = await freshScratch();
      const handle = await conn.createSession({ cwd });
      createdSessionIds.push(handle.id);

      const events = [];
      for await (const event of handle.stream('Reply with the single word OK')) {
        events.push(event);
        if (event.type === 'result') break;
      }
      const types = events.map((e) => e.type);
      expect(types).toContain('assistant');
      expect(types).toContain('result');
      const result = events.find((e) => e.type === 'result');
      if (result?.type !== 'result') throw new Error('unreachable');
      expect(result.success).toBe(true);
      expect(result.text.toUpperCase()).toContain('OK');
      await handle.detach();
      conn.disconnect();
    },
  );
});
