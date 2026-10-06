/**
 * Integration tests for custom models against the REAL daemon on 127.0.0.1:3101.
 * Only dummy keys are used. Every entry the test creates is removed in `afterAll`
 * and the final list is compared with the recorded pre-state. No model prompt is sent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDaemonConnection } from './connection';
import type { DaemonConnection } from './connection';
import type { CustomModel } from './custom-models';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

const MODEL = 'val-int-model';
const DUMMY_KEY = 'sk-dummy-0000-NOTAREALKEY';
const open: DaemonConnection[] = [];
let conn: DaemonConnection;
let preState: string[] = [];

async function connect(): Promise<DaemonConnection> {
  const connection = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY!, keepAliveMs: 0 });
  await connection.connect();
  open.push(connection);
  return connection;
}

/** An independent read on its own connection. */
async function independent(): Promise<CustomModel[]> {
  const other = await connect();
  try {
    return await other.customModels.list();
  } finally {
    other.disconnect();
  }
}

const find = (list: CustomModel[]) => list.find((item) => item.model === MODEL);
const ids = (list: CustomModel[]) => list.map((item) => item.model).sort();

beforeAll(async () => {
  conn = await connect();
  preState = ids(await conn.customModels.list());
});

afterAll(async () => {
  try {
    const leftover = find(await conn.customModels.list());
    if (leftover) await conn.customModels.remove(leftover);
    expect(ids(await independent())).toEqual(preState);
  } finally {
    for (const connection of open) connection.disconnect();
  }
});

describe('custom models against the real daemon', () => {
  it('adds an entry whose list shows a mask and never the key', async () => {
    await conn.customModels.save({
      provider: 'generic-chat-completion-api',
      model: MODEL,
      displayName: 'val-int',
      baseUrl: 'http://127.0.0.1:3198/v1',
      apiKey: DUMMY_KEY,
    });
    const entry = find(await independent());
    expect(entry).toMatchObject({
      displayName: 'val-int',
      provider: 'generic-chat-completion-api',
      baseUrl: 'http://127.0.0.1:3198/v1',
      hasApiKey: true,
    });
    expect(entry?.apiKeyMask).toMatch(/^•+.{0,4}$/u);
    expect(JSON.stringify(entry)).not.toContain('NOTAREAL');
  });

  it('keeps the stored key when an edit sends no key', async () => {
    const before = find(await conn.customModels.list())!;
    await conn.customModels.save(
      {
        provider: 'generic-chat-completion-api',
        model: MODEL,
        displayName: 'val-int-renamed',
        baseUrl: 'http://127.0.0.1:3198/v1',
        apiKey: '',
      },
      { rawIndex: before.rawIndex, model: before.model },
    );
    const after = find(await independent())!;
    expect(after.displayName).toBe('val-int-renamed');
    expect(after.hasApiKey).toBe(true);
    expect(after.apiKeyMask).toBe(before.apiKeyMask);
  });

  it('appears in the model list and disappears after delete', async () => {
    const models = await conn.listModels();
    expect(models.some((item) => item.displayName === 'val-int-renamed')).toBe(true);
    const entry = find(await conn.customModels.list())!;
    await conn.customModels.remove(entry);
    expect(find(await independent())).toBeUndefined();
    const after = await conn.listModels();
    expect(after.some((item) => item.displayName === 'val-int-renamed')).toBe(false);
  });
});
