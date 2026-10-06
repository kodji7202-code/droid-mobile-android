/**
 * Integration tests for custom slash commands against the REAL daemon on
 * 127.0.0.1:3101. Reads only; a command is invoked once through a minimal
 * prompt and its session archived afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import type { DaemonConnection } from './connection';
import { removeScratchDir } from './integration-cleanup';
import { addPendingUser, applyStreamEvent, itemsFromMessages } from './transcript';
import type { TranscriptItem } from './transcript';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

const COMMAND = 'val-hello';
const open: DaemonConnection[] = [];
let projectDir = '';
let emptyDir = '';

async function connect(): Promise<DaemonConnection> {
  const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY!, keepAliveMs: 0 });
  await conn.connect();
  open.push(conn);
  return conn;
}

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'val-commands-int-'));
  emptyDir = await mkdtemp(join(tmpdir(), 'val-commands-empty-'));
  const dir = join(projectDir, '.factory', 'commands');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${COMMAND}.md`),
    '---\ndescription: Validation hello command\nargument-hint: "[topic]"\n---\nReply with the single word OK.\n',
  );
});

afterAll(async () => {
  for (const item of open) {
    await item.commands.release().catch(() => undefined);
    item.disconnect();
  }
  await removeScratchDir(projectDir);
  await removeScratchDir(emptyDir);
});

describe('commands against the real daemon', () => {
  it('lists the project command with its description and argument hint', async () => {
    const conn = await connect();
    const commands = await conn.commands.list(projectDir);
    expect(commands.find((command) => command.name === COMMAND)).toEqual({
      name: COMMAND,
      description: 'Validation hello command',
      argumentHint: '[topic]',
    });
  });

  it('lists nothing project-level for a folder without commands', async () => {
    const conn = await connect();
    const commands = await conn.commands.list(emptyDir);
    expect(commands.some((command) => command.name === COMMAND)).toBe(false);
  });

  it('lists the commands of an open session by its id', async () => {
    const conn = await connect();
    const handle = await conn.createSession({ cwd: projectDir });
    try {
      const commands = await conn.commands.listForSession(handle.id);
      expect(commands.map((command) => command.name)).toContain(COMMAND);
    } finally {
      await handle.close().catch(() => undefined);
    }
  });
  it(
    'runs a command sent as text: stored as "/<name> is running", body delivered, live equals stored',
    { timeout: 120_000 },
    async () => {
      const conn = await connect();
      const handle = await conn.createSession({ cwd: projectDir });
      try {
        let live: readonly TranscriptItem[] = addPendingUser([], 'local-1', `/${COMMAND}`);
        for await (const event of handle.stream(`/${COMMAND}`)) {
          live = applyStreamEvent(live, event);
        }
        const stored = itemsFromMessages(await conn.listAllMessages(handle.id));
        expect(stored).toContainEqual(
          expect.objectContaining({ kind: 'user', text: `/${COMMAND} is running` }),
        );
        expect(stored).toContainEqual(
          expect.objectContaining({ notice: true, text: 'Reply with the single word OK.' }),
        );
        expect(stored.at(-1)).toMatchObject({ kind: 'assistant', text: 'OK' });
        expect(live.filter((item) => item.kind === 'user' && item.delivery !== 'sent')).toEqual([]);
        expect(live.map((item) => item.kind)).toEqual(stored.map((item) => item.kind));
      } finally {
        await handle.archive({ force: true }).catch(() => undefined);
      }
    },
  );
});
