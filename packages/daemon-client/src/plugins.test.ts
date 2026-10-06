import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroid } from '@factory/droid-sdk';
import { DaemonClientError } from './errors';
import { createPluginsClient, pluginId, toMarketplace } from './plugins';

function harness() {
  const closes: string[] = [];
  let next = 0;
  const generation = { value: 1 };
  const marketplaces = {
    list: vi.fn(async () => [
      {
        name: 'factory-plugins',
        displayName: 'factory-plugins',
        source: { source: 'github', repo: 'Factory-AI/factory-plugins' },
        pluginCount: 8,
        autoUpdate: true,
        removable: true,
      },
    ]),
    add: vi.fn(async (_id: string, _source: unknown) => ({
      success: true,
      name: 'factory-plugins',
    })),
    remove: vi.fn(async () => ({ success: true })),
    update: vi.fn(async () => ({ results: [{ name: 'factory-plugins', success: true }] })),
  };
  const plugins = {
    listAvailable: vi.fn(async () => [
      { name: 'typescript', marketplace: 'factory-plugins', description: 'TS patterns' },
      { name: 'core', marketplace: 'factory-plugins' },
    ]),
    listInstalled: vi.fn(async () => [
      {
        id: 'typescript@factory-plugins',
        scope: 'user',
        version: 'd362dc182330',
        installPath: 'C:\\x',
        installedAt: '2026-10-06T01:23:43.003Z',
        lastUpdated: '2026-10-06T01:23:43.003Z',
        source: 'factory-plugins',
        active: false,
        managed: false,
        reason: 'not enabled',
      },
    ]),
    install: vi.fn(async () => ({ success: true, pluginId: 'typescript@factory-plugins' })),
    uninstall: vi.fn(async () => ({ success: true })),
    setEnabled: vi.fn(async () => ({ success: true })),
    update: vi.fn(async () => ({
      results: [{ pluginId: 'typescript@factory-plugins', success: true }],
    })),
  };
  const create = vi.fn(async () => {
    const id = `scratch-${++next}`;
    return { id, close: vi.fn(async () => void closes.push(id)) };
  });
  const droid = {
    workspace: {
      validateDirectory: vi.fn(async () => ({ isValid: true, resolvedPath: '/home/user' })),
    },
    sessions: { create },
    marketplaces,
    plugins,
  } as unknown as ConnectedDroid;
  const client = createPluginsClient({
    droid: () => droid,
    generation: () => generation.value,
    run: (op) => op(),
  });
  return { client, marketplaces, plugins, create, closes, generation };
}

describe('toMarketplace', () => {
  it('maps a github source to its repo and keeps the reported counts', () => {
    expect(
      toMarketplace({
        name: 'factory-plugins',
        source: { source: 'github', repo: 'Factory-AI/factory-plugins' },
        pluginCount: 8,
        autoUpdate: true,
        removable: true,
      } as never),
    ).toEqual({
      name: 'factory-plugins',
      sourceKind: 'github',
      sourceLocation: 'Factory-AI/factory-plugins',
      pluginCount: 8,
      autoUpdate: true,
      removable: true,
    });
  });

  it('maps url and local sources and omits what the daemon did not report', () => {
    expect(
      toMarketplace({ name: 'a', source: { source: 'url', url: 'https://x.test/m.git' } } as never),
    ).toEqual({ name: 'a', sourceKind: 'url', sourceLocation: 'https://x.test/m.git' });
    expect(toMarketplace({ name: 'b', source: { source: 'local' } } as never)).toEqual({
      name: 'b',
      sourceKind: 'local',
    });
  });
});

describe('pluginId', () => {
  it('joins plugin and marketplace the way the daemon does', () => {
    expect(pluginId('typescript', 'factory-plugins')).toBe('typescript@factory-plugins');
  });
});

describe('createPluginsClient marketplaces', () => {
  it('opens one scratch session in the home folder and reuses it', async () => {
    const { client, create, marketplaces } = harness();
    await client.listMarketplaces();
    await client.listMarketplaces();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ cwd: '/home/user' });
    expect(marketplaces.list).toHaveBeenCalledWith('scratch-1');
  });

  it('lists marketplaces as the daemon reports them', async () => {
    const { client } = harness();
    expect(await client.listMarketplaces()).toEqual([
      {
        name: 'factory-plugins',
        displayName: 'factory-plugins',
        sourceKind: 'github',
        sourceLocation: 'Factory-AI/factory-plugins',
        pluginCount: 8,
        autoUpdate: true,
        removable: true,
      },
    ]);
  });

  it('adds a github marketplace and returns the name the daemon chose', async () => {
    const { client, marketplaces } = harness();
    await expect(client.addMarketplace('Factory-AI/factory-plugins')).resolves.toBe(
      'factory-plugins',
    );
    expect(marketplaces.add).toHaveBeenCalledWith('scratch-1', {
      source: 'github',
      repo: 'Factory-AI/factory-plugins',
    });
  });

  it('surfaces the daemon error text when the add is refused', async () => {
    const { client, marketplaces } = harness();
    marketplaces.add.mockResolvedValueOnce({
      success: false,
      error: 'Could not download marketplace. Repository not found',
    } as never);
    await expect(client.addMarketplace('Factory-AI/nope')).rejects.toMatchObject({
      name: 'DaemonClientError',
      message: 'Could not download marketplace. Repository not found',
    });
  });

  it('removes a marketplace and throws the daemon error when refused', async () => {
    const { client, marketplaces } = harness();
    await client.removeMarketplace('factory-plugins');
    expect(marketplaces.remove).toHaveBeenCalledWith('scratch-1', 'factory-plugins');
    marketplaces.remove.mockResolvedValueOnce({
      success: false,
      error: 'Managed by policy',
    } as never);
    await expect(client.removeMarketplace('factory-plugins')).rejects.toThrow('Managed by policy');
  });

  it('updates one marketplace and throws the first failing result error', async () => {
    const { client, marketplaces } = harness();
    await client.updateMarketplace('factory-plugins');
    expect(marketplaces.update).toHaveBeenCalledWith('scratch-1', 'factory-plugins');
    marketplaces.update.mockResolvedValueOnce({
      results: [{ name: 'factory-plugins', success: false, error: 'git fetch failed' }],
    } as never);
    await expect(client.updateMarketplace('factory-plugins')).rejects.toThrow('git fetch failed');
  });

  it('gives a generic error when a failed result has no text', async () => {
    const { client, marketplaces } = harness();
    marketplaces.update.mockResolvedValueOnce({
      results: [{ name: 'factory-plugins', success: false }],
    } as never);
    await expect(client.updateMarketplace('factory-plugins')).rejects.toBeInstanceOf(
      DaemonClientError,
    );
  });
});

describe('createPluginsClient plugins', () => {
  it('lists available plugins with their id', async () => {
    const { client } = harness();
    expect(await client.listAvailable()).toEqual([
      {
        id: 'typescript@factory-plugins',
        name: 'typescript',
        marketplace: 'factory-plugins',
        description: 'TS patterns',
      },
      { id: 'core@factory-plugins', name: 'core', marketplace: 'factory-plugins' },
    ]);
  });

  it('lists installed plugins with scope, active flag and reason', async () => {
    const { client } = harness();
    expect(await client.listInstalled()).toEqual([
      {
        id: 'typescript@factory-plugins',
        scope: 'user',
        version: 'd362dc182330',
        source: 'factory-plugins',
        active: false,
        managed: false,
        reason: 'not enabled',
      },
    ]);
  });

  it('installs from a marketplace at user scope by default and returns the plugin id', async () => {
    const { client, plugins } = harness();
    await expect(
      client.install({ marketplace: 'factory-plugins', name: 'typescript' }),
    ).resolves.toBe('typescript@factory-plugins');
    expect(plugins.install).toHaveBeenCalledWith(
      'scratch-1',
      'factory-plugins',
      'typescript',
      'user',
    );
  });

  it('uninstalls and switches a plugin at the given scope', async () => {
    const { client, plugins } = harness();
    await client.uninstall('typescript@factory-plugins', 'user');
    expect(plugins.uninstall).toHaveBeenCalledWith(
      'scratch-1',
      'typescript@factory-plugins',
      'user',
    );
    await client.setEnabled('typescript@factory-plugins', 'user', false);
    expect(plugins.setEnabled).toHaveBeenCalledWith(
      'scratch-1',
      'typescript@factory-plugins',
      'user',
      false,
    );
  });

  it('throws the daemon error for a refused install, uninstall or switch', async () => {
    const { client, plugins } = harness();
    plugins.install.mockResolvedValueOnce({ success: false, error: 'Plugin not found' } as never);
    await expect(client.install({ marketplace: 'm', name: 'x' })).rejects.toThrow(
      'Plugin not found',
    );
    plugins.uninstall.mockResolvedValueOnce({ success: false, error: 'Not installed' } as never);
    await expect(client.uninstall('x@m', 'user')).rejects.toThrow('Not installed');
    plugins.setEnabled.mockResolvedValueOnce({ success: false, error: 'Managed' } as never);
    await expect(client.setEnabled('x@m', 'user', true)).rejects.toThrow('Managed');
  });

  it('updates a plugin and throws when its result failed', async () => {
    const { client, plugins } = harness();
    await client.updatePlugin('typescript@factory-plugins', 'user');
    expect(plugins.update).toHaveBeenCalledWith('scratch-1', 'typescript@factory-plugins', 'user');
    plugins.update.mockResolvedValueOnce({
      results: [{ pluginId: 'typescript@factory-plugins', success: false, error: 'No update' }],
    } as never);
    await expect(client.updatePlugin('typescript@factory-plugins', 'user')).rejects.toThrow(
      'No update',
    );
  });
});

describe('createPluginsClient scratch session', () => {
  it('replaces the scratch session after a reconnect', async () => {
    const { client, create, generation } = harness();
    await client.listMarketplaces();
    generation.value = 2;
    await client.listMarketplaces();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('closes the scratch session on release and opens a new one afterwards', async () => {
    const { client, create, closes } = harness();
    await client.listAvailable();
    await client.release();
    expect(closes).toEqual(['scratch-1']);
    await client.listAvailable();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
