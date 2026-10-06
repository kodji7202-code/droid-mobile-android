/**
 * Integration tests for MCP server management against the REAL daemon on
 * 127.0.0.1:3101. Servers are prefixed `val-`, every one is removed again and
 * the list is compared with the recorded pre-state. No model prompt is sent.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import type { DaemonConnection } from './connection';
import type { McpServer } from './mcp';
import { removeScratchDir } from './integration-cleanup';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

const FIXTURE = `import { createInterface } from 'node:readline';
const tools = [
  { name: 'val_echo', description: 'Echo the given text', inputSchema: { type: 'object', properties: {} } },
  { name: 'val_time', description: 'Return the current time', inputSchema: { type: 'object', properties: {} } },
];
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'val-mcp', version: '1' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools } });
  else send({ id: m.id, result: {} });
});
`;

const open: DaemonConnection[] = [];
let scratchDir: string | undefined;

async function connect(): Promise<DaemonConnection> {
  const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY!, keepAliveMs: 0 });
  await conn.connect();
  open.push(conn);
  return conn;
}

/** An independent read: a new connection and scratch session, since other sessions lag behind. */
async function independent<T>(read: (conn: DaemonConnection) => Promise<T>): Promise<T> {
  const conn = await connect();
  try {
    return await read(conn);
  } finally {
    await conn.mcp.release().catch(() => undefined);
    conn.disconnect();
  }
}

const servers = () => independent((conn) => conn.mcp.listServers());

/** Polls one fresh session until the daemon list satisfies `done` (a new session connects every server itself). */
function serversUntil(done: (list: McpServer[]) => boolean): Promise<McpServer[]> {
  return independent(async (conn) => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const list = await conn.mcp.listServers();
      if (done(list) || Date.now() > deadline) return list;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
}

const named = (list: McpServer[], name: string) => list.find((server) => server.name === name);
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
afterAll(async () => {
  for (const conn of open) {
    await conn.mcp.release().catch(() => undefined);
    conn.disconnect();
  }
  if (scratchDir) await removeScratchDir(scratchDir);
});

describe('MCP servers (real daemon 3101)', () => {
  it(
    'adds, toggles, lists tools for and removes servers, seen by an independent connection',
    { timeout: 120_000 },
    async () => {
      const app = await connect();
      scratchDir = await mkdtemp(join(tmpdir(), 'droidm-scratch-mcp-'));
      const fixture = join(scratchDir, 'val-mcp-server.mjs');
      await writeFile(fixture, FIXTURE);
      const before = (await servers()).map((server) => server.name).sort();

      try {
        await app.mcp.addServer({
          type: 'http',
          name: 'val-http-dummy',
          url: 'http://127.0.0.1:3199/mcp',
        });
        await app.mcp.addServer({
          type: 'stdio',
          name: 'val-mcp',
          command: 'node',
          args: [fixture],
        });

        const added = await serversUntil(
          (list) =>
            named(list, 'val-mcp')?.toolCount === 2 &&
            named(list, 'val-http-dummy')?.status === 'failed',
        );
        expect(named(added, 'val-http-dummy')).toMatchObject({
          serverType: 'http',
          status: 'failed',
          source: 'user',
        });
        expect(named(added, 'val-http-dummy')?.error).toMatch(/Failed to connect/);
        expect(named(added, 'val-mcp')).toMatchObject({
          serverType: 'stdio',
          status: 'connected',
          toolCount: 2,
        });

        const tools = await independent(async (conn) => {
          await until(
            () => conn.mcp.listTools('val-mcp'),
            (list) => list.length === 2,
          );
          return conn.mcp.listTools('val-mcp');
        });
        expect(tools.map((tool) => tool.name).sort()).toEqual(['val_echo', 'val_time']);

        await app.mcp.toggleServer('val-http-dummy', false);
        const off = await serversUntil(
          (list) => named(list, 'val-http-dummy')?.status === 'disabled',
        );
        expect(named(off, 'val-http-dummy')?.status).toBe('disabled');
        await app.mcp.toggleServer('val-http-dummy', true);
        const on = await serversUntil((list) => named(list, 'val-http-dummy')?.status === 'failed');
        expect(named(on, 'val-http-dummy')?.status).toBe('failed');
      } finally {
        for (const name of ['val-http-dummy', 'val-mcp']) {
          await app.mcp.removeServer(name).catch(() => undefined);
        }
      }

      const after = await serversUntil((list) =>
        list.every((server) => !server.name.startsWith('val-')),
      );
      expect(after.map((server) => server.name).sort()).toEqual(before);
    },
  );

  it(
    'shows Authentication required for an OAuth server and cancels a pending sign-in',
    { timeout: 120_000 },
    async () => {
      const app = await connect();
      const before = (await servers()).map((server) => server.name).sort();
      try {
        await app.mcp.addServer({
          type: 'http',
          name: 'val-oauth-dummy',
          url: 'https://mcp.linear.app/mcp',
        });
        const settled = await serversUntil(
          (list) => named(list, 'val-oauth-dummy')?.requiresAuth === true,
        );
        expect(named(settled, 'val-oauth-dummy')).toMatchObject({
          requiresAuth: true,
          error: 'Authentication required',
        });

        const signIn = app.mcp.authenticateServer('val-oauth-dummy').then(
          () => 'resolved',
          () => 'rejected',
        );
        // The authorization page is state of the session that started the sign-in.
        const pending = await until(
          () => app.mcp.listServers(),
          (list) => Boolean(named(list, 'val-oauth-dummy')?.pendingAuthUrl),
        );
        expect(new URL(named(pending, 'val-oauth-dummy')!.pendingAuthUrl!).host).toBe(
          'mcp.linear.app',
        );

        await app.mcp.cancelAuth('val-oauth-dummy');
        expect(await signIn).toBe('rejected');
        const row = named(await app.mcp.listServers(), 'val-oauth-dummy');
        expect(row?.pendingAuthUrl).toBeUndefined();
        expect(row?.requiresAuth).toBe(true);
      } finally {
        await app.mcp.clearAuth('val-oauth-dummy').catch(() => undefined);
        await app.mcp.removeServer('val-oauth-dummy').catch(() => undefined);
      }
      const after = await serversUntil((list) =>
        list.every((server) => !server.name.startsWith('val-')),
      );
      expect(after.map((server) => server.name).sort()).toEqual(before);
    },
  );
});
