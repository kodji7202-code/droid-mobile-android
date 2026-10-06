import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AvailablePlugin,
  DaemonConnection,
  InstalledPlugin,
  Marketplace,
} from '@droidmobile/daemon-client';
import { renderAppAt } from '../../../test/render-app';
import { useConnectionStore } from '../../../stores/connection';

const AVAILABLE: AvailablePlugin[] = [
  {
    id: 'typescript@factory-plugins',
    name: 'typescript',
    marketplace: 'factory-plugins',
    description: 'Opinionated TypeScript patterns',
  },
  { id: 'core@factory-plugins', name: 'core', marketplace: 'factory-plugins' },
];

const MARKETPLACE: Marketplace = {
  name: 'factory-plugins',
  sourceKind: 'github',
  sourceLocation: 'Factory-AI/factory-plugins',
  pluginCount: 2,
  removable: true,
};

type PluginsApi = DaemonConnection['plugins'];

function installedEntry(id: string, active = true): InstalledPlugin {
  return {
    id,
    scope: 'user',
    version: 'abc123',
    source: id.split('@')[1] ?? '',
    active,
    managed: false,
    reason: active ? 'enabled' : 'not enabled',
  };
}

function setup(
  options: {
    available?: AvailablePlugin[];
    installed?: InstalledPlugin[];
    overrides?: Partial<PluginsApi>;
  } = {},
) {
  const state = {
    available: (options.available ?? AVAILABLE).map((plugin) => ({ ...plugin })),
    installed: (options.installed ?? []).map((plugin) => ({ ...plugin })),
  };
  const plugins = {
    listMarketplaces: vi.fn(async () => [MARKETPLACE]),
    listAvailable: vi.fn(async () => state.available.map((plugin) => ({ ...plugin }))),
    listInstalled: vi.fn(async () => state.installed.map((plugin) => ({ ...plugin }))),
    install: vi.fn(async (input: { marketplace: string; name: string; scope?: string }) => {
      const id = `${input.name}@${input.marketplace}`;
      state.installed.push(installedEntry(id));
      return id;
    }),
    uninstall: vi.fn(async (id: string) => {
      state.installed = state.installed.filter((plugin) => plugin.id !== id);
    }),
    setEnabled: vi.fn(async (id: string, _scope: string, enabled: boolean) => {
      const plugin = state.installed.find((item) => item.id === id);
      if (plugin) Object.assign(plugin, installedEntry(id, enabled));
    }),
    updatePlugin: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    ...options.overrides,
  } as unknown as PluginsApi;
  const connection = { plugins } as unknown as DaemonConnection;
  useConnectionStore.setState({ status: 'ready' });
  renderAppAt('/extensions/plugins', { connection });
  return { state, plugins };
}

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });
});

describe('PluginsScreen list', () => {
  it('shows a labelled loading state while the daemon lists are pending', () => {
    setup({ overrides: { listAvailable: () => new Promise(() => {}) } });
    expect(screen.getByTestId('plugins-loading')).toHaveAccessibleName('Loading plugins');
  });

  it('shows exactly the available plugins with name, description and marketplace', async () => {
    setup();
    const list = await screen.findByTestId('plugins-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByTestId('plugin-row-typescript@factory-plugins')).toHaveTextContent(
      'typescript',
    );
    expect(screen.getByTestId('plugin-description-typescript@factory-plugins')).toHaveTextContent(
      'Opinionated TypeScript patterns',
    );
    expect(screen.getByTestId('plugin-marketplace-core@factory-plugins')).toHaveTextContent(
      'factory-plugins',
    );
    expect(screen.getByTestId('plugin-description-core@factory-plugins')).toHaveTextContent(
      'No description provided.',
    );
  });

  it('marks an installed plugin and offers Uninstall instead of Install', async () => {
    setup({ installed: [installedEntry('typescript@factory-plugins')] });
    await screen.findByTestId('plugins-list');
    expect(screen.getByTestId('plugin-installed-typescript@factory-plugins')).toHaveTextContent(
      'Installed',
    );
    expect(screen.getByTestId('plugin-uninstall-typescript@factory-plugins')).toBeInTheDocument();
    expect(screen.queryByTestId('plugin-install-typescript@factory-plugins')).toBeNull();
    expect(screen.getByTestId('plugin-install-core@factory-plugins')).toBeInTheDocument();
    expect(screen.queryByTestId('plugin-installed-core@factory-plugins')).toBeNull();
  });

  it('shows the empty state with a link to marketplaces when nothing is offered', async () => {
    setup({ available: [] });
    expect(await screen.findByTestId('plugins-empty')).toHaveTextContent('No plugins available');
    expect(screen.getByTestId('plugins-empty-marketplaces')).toHaveAttribute(
      'href',
      '/extensions/plugins/marketplaces',
    );
  });

  it('shows an error with retry when the daemon does not answer, then recovers', async () => {
    const listAvailable = vi
      .fn<() => Promise<AvailablePlugin[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(AVAILABLE);
    setup({ overrides: { listAvailable } as Partial<PluginsApi> });
    expect(await screen.findByTestId('plugins-error')).toHaveTextContent('Could not load plugins');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('plugins-list')).toBeInTheDocument();
  });
});

describe('PluginsScreen install and uninstall', () => {
  it('asks for confirmation naming the plugin and scope, then installs at user scope', async () => {
    const user = userEvent.setup();
    const { plugins } = setup();
    await user.click(await screen.findByTestId('plugin-install-typescript@factory-plugins'));
    const dialog = screen.getByTestId('plugin-install-dialog');
    expect(dialog).toHaveTextContent('Install typescript?');
    expect(dialog).toHaveTextContent('factory-plugins');
    expect(dialog).toHaveTextContent('user scope');
    expect(plugins.install).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('plugin-install-dialog-confirm'));
    await waitFor(() => expect(plugins.install).toHaveBeenCalledTimes(1));
    expect(plugins.install).toHaveBeenCalledWith({
      marketplace: 'factory-plugins',
      name: 'typescript',
      scope: 'user',
    });
    expect(
      await screen.findByTestId('plugin-installed-typescript@factory-plugins'),
    ).toHaveTextContent('Installed');
    expect(screen.getByTestId('plugins-notice')).toHaveTextContent('typescript installed.');
  });

  it('keeps the plugin uninstalled when the install confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const { plugins } = setup();
    await user.click(await screen.findByTestId('plugin-install-typescript@factory-plugins'));
    await user.click(screen.getByTestId('plugin-install-dialog-cancel'));
    expect(plugins.install).not.toHaveBeenCalled();
    expect(screen.queryByTestId('plugin-install-dialog')).toBeNull();
  });

  it('surfaces the daemon error text when an install is refused', async () => {
    const user = userEvent.setup();
    setup({
      overrides: {
        install: vi.fn(async () => {
          throw new Error('Plugin "typescript" not found in marketplace');
        }),
      } as Partial<PluginsApi>,
    });
    await user.click(await screen.findByTestId('plugin-install-typescript@factory-plugins'));
    await user.click(screen.getByTestId('plugin-install-dialog-confirm'));
    const alert = await screen.findByTestId('plugins-action-error');
    expect(alert).toHaveTextContent('Could not install typescript.');
    expect(screen.getByTestId('plugins-action-error-detail')).toHaveTextContent(
      'Plugin "typescript" not found in marketplace',
    );
    expect(screen.getByTestId('plugin-install-typescript@factory-plugins')).toBeEnabled();
    await user.click(screen.getByTestId('plugins-action-error-dismiss'));
    expect(screen.queryByTestId('plugins-action-error')).toBeNull();
  });

  it('confirms before uninstalling and returns to Install afterwards', async () => {
    const user = userEvent.setup();
    const { plugins } = setup({ installed: [installedEntry('typescript@factory-plugins')] });
    await user.click(await screen.findByTestId('plugin-uninstall-typescript@factory-plugins'));
    expect(screen.getByTestId('plugin-uninstall-dialog')).toHaveTextContent(
      'Uninstall typescript?',
    );
    await user.click(screen.getByTestId('plugin-uninstall-dialog-cancel'));
    expect(plugins.uninstall).not.toHaveBeenCalled();
    expect(screen.getByTestId('plugin-installed-typescript@factory-plugins')).toBeInTheDocument();

    await user.click(screen.getByTestId('plugin-uninstall-typescript@factory-plugins'));
    await user.click(screen.getByTestId('plugin-uninstall-dialog-confirm'));
    await waitFor(() =>
      expect(plugins.uninstall).toHaveBeenCalledWith('typescript@factory-plugins', 'user'),
    );
    expect(
      await screen.findByTestId('plugin-install-typescript@factory-plugins'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('plugin-installed-typescript@factory-plugins')).toBeNull();
  });
});

describe('PluginsScreen enable, disable and update', () => {
  it('switches a plugin off and on and shows the daemon state after each', async () => {
    const user = userEvent.setup();
    const { plugins } = setup({ installed: [installedEntry('typescript@factory-plugins')] });
    const toggle = await screen.findByTestId('plugin-toggle-typescript@factory-plugins');
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleName('Enable typescript');

    await user.click(toggle);
    await waitFor(() =>
      expect(plugins.setEnabled).toHaveBeenLastCalledWith(
        'typescript@factory-plugins',
        'user',
        false,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('plugin-state-typescript@factory-plugins')).toHaveTextContent(
        'Disabled',
      ),
    );
    expect(screen.getByTestId('plugin-toggle-typescript@factory-plugins')).not.toBeChecked();

    await user.click(screen.getByTestId('plugin-toggle-typescript@factory-plugins'));
    await waitFor(() =>
      expect(screen.getByTestId('plugin-state-typescript@factory-plugins')).toHaveTextContent(
        'Enabled',
      ),
    );
    expect(plugins.setEnabled).toHaveBeenLastCalledWith('typescript@factory-plugins', 'user', true);
  });

  it('disables the switch and shows a pending indicator while the request is in flight', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    setup({
      installed: [installedEntry('typescript@factory-plugins')],
      overrides: {
        setEnabled: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        ),
      } as Partial<PluginsApi>,
    });
    await user.click(await screen.findByTestId('plugin-toggle-typescript@factory-plugins'));
    expect(screen.getByTestId('plugin-toggle-typescript@factory-plugins')).toBeDisabled();
    expect(screen.getByTestId('plugin-pending-typescript@factory-plugins')).toBeInTheDocument();
    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByTestId('plugin-toggle-typescript@factory-plugins')).toBeEnabled(),
    );
  });

  it('reports a successful update without an error and keeps the plugin installed', async () => {
    const user = userEvent.setup();
    const { plugins } = setup({ installed: [installedEntry('typescript@factory-plugins')] });
    await user.click(await screen.findByTestId('plugin-update-typescript@factory-plugins'));
    await waitFor(() =>
      expect(plugins.updatePlugin).toHaveBeenCalledWith('typescript@factory-plugins', 'user'),
    );
    expect(await screen.findByTestId('plugins-notice')).toHaveTextContent(
      'typescript is up to date.',
    );
    expect(screen.queryByTestId('plugins-action-error')).toBeNull();
    expect(screen.getByTestId('plugin-installed-typescript@factory-plugins')).toBeInTheDocument();
  });

  it('shows the daemon error when an update fails', async () => {
    const user = userEvent.setup();
    setup({
      installed: [installedEntry('typescript@factory-plugins')],
      overrides: {
        updatePlugin: vi.fn(async () => {
          throw new Error('git fetch failed');
        }),
      } as Partial<PluginsApi>,
    });
    await user.click(await screen.findByTestId('plugin-update-typescript@factory-plugins'));
    expect(await screen.findByTestId('plugins-action-error')).toHaveTextContent(
      'Could not update typescript.',
    );
    expect(screen.getByTestId('plugins-action-error-detail')).toHaveTextContent('git fetch failed');
  });

  it('locks switch and uninstall for a managed plugin', async () => {
    setup({
      installed: [{ ...installedEntry('typescript@factory-plugins'), managed: true }],
    });
    expect(await screen.findByTestId('plugin-toggle-typescript@factory-plugins')).toBeDisabled();
    expect(screen.getByTestId('plugin-uninstall-typescript@factory-plugins')).toBeDisabled();
  });
});

describe('PluginsScreen installed plugins without a marketplace', () => {
  it('still lists a plugin its marketplace no longer offers so it can be removed', async () => {
    setup({ installed: [installedEntry('orphan@gone')] });
    await screen.findByTestId('plugins-list');
    expect(screen.getByTestId('plugin-row-orphan@gone')).toHaveTextContent('orphan');
    expect(screen.getByTestId('plugin-uninstall-orphan@gone')).toBeEnabled();
  });
});
