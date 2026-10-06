/**
 * Integration tests for automations against the REAL daemon on 127.0.0.1:3101.
 * The test automation is created paused through the SDK (creation is not an app
 * feature) and deleted in `afterAll`; the final list must equal the recorded
 * pre-state. `run` returns a descriptor and starts no session, so nothing is spent.
 */
import { connectToDaemon } from '@factory/droid-sdk';
import type { ConnectedDroid } from '@factory/droid-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDaemonConnection } from './connection';
import type { DaemonConnection } from './connection';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

const ID = 'val-int-auto';
const PROMPT = 'Reply with the single word OK';
let admin: ConnectedDroid;
let conn: DaemonConnection;
let preState: string[] = [];

const names = (list: readonly { name: string }[]) => list.map((item) => item.name).sort();

async function deleteTestAutomation(): Promise<void> {
  for (const entry of await admin.automations.list()) {
    if (entry.id === ID && entry.uuid) await admin.automations.delete({ automationId: entry.uuid });
  }
}

beforeAll(async () => {
  admin = await connectToDaemon({ url: DAEMON_URL, auth: { apiKey: API_KEY! } });
  conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY!, keepAliveMs: 0 });
  await conn.connect();
  await deleteTestAutomation();
  preState = names(await admin.automations.list());
  const created = await admin.automations.create({
    id: ID,
    name: ID,
    schedule: 'weekly',
    paused: true,
    instructions: PROMPT,
  });
  expect(created.success).toBe(true);
});

afterAll(async () => {
  try {
    await deleteTestAutomation();
    expect(names(await admin.automations.list())).toEqual(preState);
  } finally {
    conn.disconnect();
    admin.disconnect();
  }
});

describe('automations against the real daemon', () => {
  it('lists the paused test automation with its schedule and prompt', async () => {
    const entry = (await conn.automations.list()).find((item) => item.id === ID);
    expect(entry).toMatchObject({ name: ID, status: 'paused', schedule: 'weekly', prompt: PROMPT });
    expect(entry?.nextRunAt).toBeUndefined();
  });

  it('returns a run descriptor for a paused automation without opening a session', async () => {
    const before = (await conn.listOpenedSessions()).length;
    const descriptor = await conn.automations.run(ID);
    expect(descriptor.automationName).toBe(ID);
    expect(descriptor.cwd.replace(/\\/g, '/')).toMatch(/\.factory\/automations\/val-int-auto$/);
    expect(descriptor.prompt).toContain(PROMPT);
    expect((await conn.listOpenedSessions()).length).toBe(before);
  });

  it('resumes (with a next run) and pauses again, matching an independent read', async () => {
    expect(await conn.automations.resume(ID)).toBe('active');
    const active = (await admin.automations.list()).find((item) => item.id === ID);
    expect(active?.status).toBe('active');
    expect(active?.nextRunAt).toBeTruthy();
    expect(await conn.automations.pause(ID)).toBe('paused');
    const paused = (await admin.automations.list()).find((item) => item.id === ID);
    expect(paused?.status).toBe('paused');
    expect(paused?.nextRunAt).toBeUndefined();
  });

  it('reports an empty history for a fresh automation', async () => {
    expect(await conn.automations.history(ID)).toEqual({ runs: [], totalCount: 0 });
  });
});
