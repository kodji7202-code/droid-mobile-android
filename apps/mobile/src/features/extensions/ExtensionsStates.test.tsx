import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';

type Reader<T> = () => Promise<T>;

interface Fakes {
  mcp?: Reader<unknown[]>;
  skills?: Reader<{ skills: unknown[]; projectAvailable: boolean }>;
  marketplaces?: Reader<unknown[]>;
  available?: Reader<unknown[]>;
  installed?: Reader<unknown[]>;
  commands?: Reader<unknown[]>;
  customModels?: Reader<unknown[]>;
}

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

function connectionOf(fakes: Fakes): DaemonConnection {
  return {
    mcp: {
      listServers: vi.fn(fakes.mcp ?? (async () => [])),
      release: vi.fn(async () => {}),
    },
    skills: {
      list: vi.fn(fakes.skills ?? (async () => ({ skills: [], projectAvailable: false }))),
      release: vi.fn(async () => {}),
    },
    plugins: {
      listMarketplaces: vi.fn(fakes.marketplaces ?? (async () => [])),
      listAvailable: vi.fn(fakes.available ?? (async () => [])),
      listInstalled: vi.fn(fakes.installed ?? (async () => [])),
      release: vi.fn(async () => {}),
    },
    commands: { list: vi.fn(fakes.commands ?? (async () => [])), release: vi.fn(async () => {}) },
    customModels: { list: vi.fn(fakes.customModels ?? (async () => [])) },
  } as unknown as DaemonConnection;
}

function open(path: string, fakes: Fakes) {
  useConnectionStore.setState({ status: 'ready', readyEpoch: 1 });
  renderAppAt(path, { connection: connectionOf(fakes) });
}

interface ListCase {
  name: string;
  path: string;
  prefix: string;
  loadingName: string;
  pending: Fakes;
  empty: Fakes;
  filled: Fakes;
  fail: Fakes;
  listId: string;
}

const failing = async (): Promise<never> => {
  throw new Error('daemon unreachable');
};

const CASES: ListCase[] = [
  {
    name: 'MCP servers',
    path: '/extensions/mcp',
    prefix: 'mcp',
    loadingName: 'Loading MCP servers',
    listId: 'mcp-list',
    pending: { mcp: never },
    empty: { mcp: async () => [] },
    filled: {
      mcp: async () => [
        { name: 'val-mcp', status: 'connected', serverType: 'stdio', source: 'user' },
      ],
    },
    fail: { mcp: failing },
  },
  {
    name: 'Skills',
    path: '/extensions/skills',
    prefix: 'skills',
    loadingName: 'Loading skills',
    listId: 'skills-list',
    pending: { skills: never },
    empty: { skills: async () => ({ skills: [], projectAvailable: false }) },
    filled: {
      skills: async () => ({
        skills: [{ name: 'val-skill', description: 'd', location: 'user', enabled: true }],
        projectAvailable: false,
      }),
    },
    fail: { skills: failing },
  },
  {
    name: 'Marketplaces',
    path: '/extensions/plugins/marketplaces',
    prefix: 'marketplaces',
    loadingName: 'Loading marketplaces',
    listId: 'marketplaces-list',
    pending: { marketplaces: never },
    empty: { marketplaces: async () => [] },
    filled: {
      marketplaces: async () => [
        {
          name: 'val-market',
          sourceKind: 'github',
          sourceLocation: 'a/b',
          pluginCount: 1,
          removable: true,
        },
      ],
    },
    fail: { marketplaces: failing },
  },
  {
    name: 'Plugins (available list pending)',
    path: '/extensions/plugins',
    prefix: 'plugins',
    loadingName: 'Loading plugins',
    listId: 'plugins-list',
    pending: { available: never },
    empty: { available: async () => [], installed: async () => [] },
    filled: {
      available: async () => [{ id: 'p@val-market', name: 'p', marketplace: 'val-market' }],
    },
    fail: { available: failing },
  },
  {
    name: 'Plugins (installed list pending)',
    path: '/extensions/plugins',
    prefix: 'plugins',
    loadingName: 'Loading plugins',
    listId: 'plugins-list',
    pending: { installed: never },
    empty: { available: async () => [], installed: async () => [] },
    filled: {
      installed: async () => [
        {
          id: 'p@val-market',
          scope: 'user',
          version: '1',
          source: 'val-market',
          active: true,
          managed: false,
        },
      ],
    },
    fail: { installed: failing },
  },
  {
    name: 'Commands',
    path: '/extensions/commands',
    prefix: 'commands',
    loadingName: 'Loading commands',
    listId: 'commands-list',
    pending: { commands: never },
    empty: { commands: async () => [] },
    filled: { commands: async () => [{ name: 'val-hello', description: 'd' }] },
    fail: { commands: failing },
  },
  {
    name: 'Custom models',
    path: '/extensions/custom-models',
    prefix: 'custom-models',
    loadingName: 'Loading custom models',
    listId: 'custom-models-list',
    pending: { customModels: never },
    empty: { customModels: async () => [] },
    filled: {
      customModels: async () => [
        {
          rawIndex: 0,
          model: 'val-model',
          provider: 'openai',
          baseUrl: 'https://example.invalid/v1',
          apiKeyMask: 'sk-…1234',
        },
      ],
    },
    fail: { customModels: failing },
  },
];

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

describe('Extensions hub', () => {
  it('hosts exactly the five sections with localized titles', () => {
    open('/extensions', {});
    const nav = screen.getByRole('navigation', { name: 'Extensions' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('data-testid'))).toEqual([
      'extensions-mcp',
      'extensions-skills',
      'extensions-plugins',
      'extensions-commands',
      'extensions-custom-models',
    ]);
    for (const link of links) {
      expect(link.textContent).not.toMatch(/extensions\.[a-zA-Z]+\./);
      expect(link.textContent ?? '').not.toBe('');
    }
    expect(links[0]).toHaveTextContent('MCP servers');
    expect(links[1]).toHaveTextContent('Skills');
    expect(links[2]).toHaveTextContent('Plugins');
    expect(links[3]).toHaveTextContent('Commands');
    expect(links[4]).toHaveTextContent('Custom models');
  });

  it.each([
    ['extensions-mcp', 'mcp-screen'],
    ['extensions-skills', 'skills-screen'],
    ['extensions-plugins', 'plugins-screen'],
    ['extensions-commands', 'commands-screen'],
    ['extensions-custom-models', 'custom-models-screen'],
  ])('opens %s into %s', async (entry, screenId) => {
    open('/extensions', {});
    await userEvent.setup().click(screen.getByTestId(entry));
    expect(await screen.findByTestId(screenId)).toBeInTheDocument();
  });
});

describe.each(CASES)('Extensions list: $name', (item) => {
  it('shows a labelled loading placeholder while the request is pending', async () => {
    open(item.path, item.pending);
    const loading = await screen.findByTestId(`${item.prefix}-loading`);
    expect(loading).toHaveAccessibleName(item.loadingName);
    expect(screen.queryByTestId(`${item.prefix}-empty`)).toBeNull();
    expect(screen.queryByTestId(`${item.prefix}-error`)).toBeNull();
    expect(screen.queryByTestId(item.listId)).toBeNull();
  });

  it('replaces the placeholder with the list when the request resolves', async () => {
    open(item.path, item.filled);
    expect(await screen.findByTestId(item.listId)).toBeInTheDocument();
    expect(screen.queryByTestId(`${item.prefix}-loading`)).toBeNull();
  });

  it('shows the localized empty state for an empty daemon result', async () => {
    open(item.path, item.empty);
    const empty = await screen.findByTestId(`${item.prefix}-empty`);
    expect(empty.textContent ?? '').not.toBe('');
    expect(empty.textContent).not.toMatch(/\b[a-z]+\.[a-z]+\.[a-zA-Z.]+\b/);
    expect(screen.getByTestId(item.listId)).toContainElement(empty);
    expect(within(screen.getByTestId(item.listId)).queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByTestId(`${item.prefix}-loading`)).toBeNull();
  });

  it('shows an error with Retry when the request fails and recovers on Retry', async () => {
    const connection = connectionOf(item.fail);
    useConnectionStore.setState({ status: 'ready', readyEpoch: 1 });
    renderAppAt(item.path, { connection });
    expect(await screen.findByTestId(`${item.prefix}-error`)).toHaveTextContent(/could not/i);
    expect(screen.queryByTestId(item.listId)).toBeNull();
    expect(screen.getByTestId('error-state-retry')).toBeInTheDocument();
  });

  it('turns a loaded list into the error state when the link drops, then reloads on reconnect', async () => {
    open(item.path, item.filled);
    await screen.findByTestId(item.listId);

    act(() => {
      useConnectionStore.setState({ status: 'reconnecting' });
    });
    expect(await screen.findByTestId(`${item.prefix}-error`)).toBeInTheDocument();
    expect(screen.getByTestId('error-state-retry')).toBeInTheDocument();
    expect(screen.queryByTestId(item.listId)).toBeNull();

    act(() => {
      useConnectionStore.setState({ status: 'ready', readyEpoch: 2 });
    });
    await waitFor(() => expect(screen.getByTestId(item.listId)).toBeInTheDocument());
    expect(screen.queryByTestId(`${item.prefix}-error`)).toBeNull();
  });
});
