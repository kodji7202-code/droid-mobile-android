/**
 * Integration tests for marketplaces and plugins against the REAL daemon on
 * 127.0.0.1:3101. The marketplace and plugin lists are recorded first and
 * restored in `afterAll`; the plugin installed here is `typescript` from the
 * public `Factory-AI/factory-plugins` marketplace. No model prompt is sent.
 */
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

const MARKETPLACE_REPO = 'Factory-AI/factory-plugins';
const MARKETPLACE = 'factory-plugins';
const PLUGIN = 'typescript';
const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
/** Marketplace and plugin operations clone or fetch from GitHub. */
const NETWORK_TIMEOUT_MS = 90_000;

const open: DaemonConnection[] = [];
let conn: DaemonConnection;
let preMarketplaces: string[] = [];
let preInstalled: string[] = [];

async function connect(): Promise<DaemonConnection> {
  const created = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY!, keepAliveMs: 0 });
  await created.connect();
  open.push(created);
  return created;
}

/** An independent read: a new connection and scratch session. */
async function independent() {
  const other = await connect();
  try {
    return {
      marketplaces: await other.plugins.listMarketplaces(),
      available: await other.plugins.listAvailable(),
      installed: await other.plugins.listInstalled(),
    };
  } finally {
    await other.plugins.release().catch(() => undefined);
    other.disconnect();
  }
}

/** Re-reads until the condition holds: the daemon applies an uninstall slightly after it acknowledges it. */
async function eventually<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    value = await read();
  }
  return value;
}

/** A GitHub clone can fail transiently; a missing repository fails again and still surfaces. */
async function addMarketplaceOnce(repo: string): Promise<string> {
  try {
    return await conn.plugins.addMarketplace(repo);
  } catch {
    return conn.plugins.addMarketplace(repo);
  }
}

const names = (list: { name: string }[]) => list.map((item) => item.name).sort();
const ids = (list: { id: string }[]) => list.map((item) => item.id).sort();

beforeAll(async () => {
  conn = await connect();
  const before = await independent();
  preMarketplaces = names(before.marketplaces);
  preInstalled = ids(before.installed);
});

afterAll(async () => {
  const current = await independent();
  if (current.installed.some((plugin) => plugin.id === PLUGIN_ID)) {
    await conn.plugins.uninstall(PLUGIN_ID, 'user').catch(() => undefined);
  }
  if (!preMarketplaces.includes(MARKETPLACE) && names(current.marketplaces).includes(MARKETPLACE)) {
    await conn.plugins.removeMarketplace(MARKETPLACE).catch(() => undefined);
  }
  await conn.plugins.release().catch(() => undefined);
  for (const item of open) item.disconnect();
  const after = await independent();
  expect(names(after.marketplaces)).toEqual(preMarketplaces);
  expect(ids(after.installed)).toEqual(preInstalled);
});

describe('marketplaces and plugins against the real daemon', () => {
  it('surfaces the daemon error for a repository that does not exist', async () => {
    await expect(conn.plugins.addMarketplace('Factory-AI/does-not-exist-val')).rejects.toThrow(
      /Could not download marketplace/,
    );
    expect(names((await independent()).marketplaces)).toEqual(preMarketplaces);
  });

  it(
    'adds the marketplace, lists its plugins and updates it',
    async () => {
      if (!preMarketplaces.includes(MARKETPLACE)) {
        await expect(addMarketplaceOnce(MARKETPLACE_REPO)).resolves.toBe(MARKETPLACE);
      }
      const state = await independent();
      const added = state.marketplaces.find((item) => item.name === MARKETPLACE);
      expect(added).toMatchObject({ sourceKind: 'github', sourceLocation: MARKETPLACE_REPO });
      expect(added?.pluginCount).toBe(state.available.length);
      expect(state.available.map((plugin) => plugin.id)).toContain(PLUGIN_ID);
      await expect(conn.plugins.updateMarketplace(MARKETPLACE)).resolves.toBeUndefined();
    },
    NETWORK_TIMEOUT_MS,
  );

  it('reports the daemon error when updating a marketplace that is not there', async () => {
    await expect(conn.plugins.updateMarketplace('val-missing')).rejects.toThrow(/not found/);
  });

  it(
    'installs, switches, updates and uninstalls the plugin',
    async () => {
      await expect(conn.plugins.install({ marketplace: MARKETPLACE, name: PLUGIN })).resolves.toBe(
        PLUGIN_ID,
      );
      let installed = (await independent()).installed.find((plugin) => plugin.id === PLUGIN_ID);
      expect(installed).toMatchObject({ scope: 'user', active: true, reason: 'enabled' });

      await conn.plugins.setEnabled(PLUGIN_ID, 'user', false);
      installed = (await independent()).installed.find((plugin) => plugin.id === PLUGIN_ID);
      expect(installed).toMatchObject({ active: false, reason: 'not enabled' });

      await conn.plugins.setEnabled(PLUGIN_ID, 'user', true);
      installed = (await independent()).installed.find((plugin) => plugin.id === PLUGIN_ID);
      expect(installed).toMatchObject({ active: true, reason: 'enabled' });

      await expect(conn.plugins.updatePlugin(PLUGIN_ID, 'user')).resolves.toBeUndefined();
      expect(ids((await independent()).installed)).toContain(PLUGIN_ID);

      await conn.plugins.uninstall(PLUGIN_ID, 'user');
      const afterUninstall = await eventually(
        async () => ids((await independent()).installed),
        (installedIds) => !installedIds.includes(PLUGIN_ID),
      );
      expect(afterUninstall).toEqual(preInstalled.filter((id) => id !== PLUGIN_ID));
    },
    NETWORK_TIMEOUT_MS,
  );

  it('reports the daemon error for a plugin that is not installed', async () => {
    await expect(conn.plugins.updatePlugin('val-missing@val', 'user')).rejects.toThrow(
      /not installed/,
    );
  });

  it('removes the marketplace it added', async () => {
    if (preMarketplaces.includes(MARKETPLACE)) return;
    await conn.plugins.removeMarketplace(MARKETPLACE);
    expect(names((await independent()).marketplaces)).toEqual(preMarketplaces);
  });
});
