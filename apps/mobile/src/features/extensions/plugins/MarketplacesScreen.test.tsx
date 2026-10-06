import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, Marketplace } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../../test/render-app';
import { useConnectionStore } from '../../../stores/connection';

const FACTORY: Marketplace = {
  name: 'factory-plugins',
  sourceKind: 'github',
  sourceLocation: 'Factory-AI/factory-plugins',
  pluginCount: 8,
  autoUpdate: true,
  removable: true,
};

type PluginsApi = DaemonConnection['plugins'];

function setup(initial: Marketplace[] = [], overrides: Partial<PluginsApi> = {}) {
  const state = { marketplaces: initial.map((item) => ({ ...item })) };
  const plugins = {
    listMarketplaces: vi.fn(async () => state.marketplaces.map((item) => ({ ...item }))),
    addMarketplace: vi.fn(async (repo: string) => {
      const name = repo.split('/')[1] ?? repo;
      state.marketplaces.push({ ...FACTORY, name, sourceLocation: repo });
      return name;
    }),
    removeMarketplace: vi.fn(async (name: string) => {
      state.marketplaces = state.marketplaces.filter((item) => item.name !== name);
    }),
    updateMarketplace: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    ...overrides,
  } as unknown as PluginsApi;
  const connection = { plugins } as unknown as DaemonConnection;
  useConnectionStore.setState({ status: 'ready' });
  renderAppAt('/extensions/plugins/marketplaces', { connection });
  return { state, plugins };
}

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });
});

async function typeRepo(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = await screen.findByTestId('marketplace-add-repo');
  await user.clear(input);
  await user.type(input, value);
}

describe('MarketplacesScreen list', () => {
  it('shows a labelled loading state while the daemon list is pending', () => {
    setup([], { listMarketplaces: () => new Promise(() => {}) } as Partial<PluginsApi>);
    expect(screen.getByTestId('marketplaces-loading')).toHaveAccessibleName('Loading marketplaces');
  });

  it('shows the empty state with an add action when the daemon has no marketplace', async () => {
    setup([]);
    const empty = await screen.findByTestId('marketplaces-empty');
    expect(empty).toHaveTextContent('No marketplaces');
    expect(within(empty).getByTestId('marketplace-add')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('marketplaces-list')).getByTestId('marketplaces-empty'),
    ).toBeInTheDocument();
  });

  it('shows name, source repo and plugin count for each marketplace', async () => {
    setup([FACTORY]);
    const row = await screen.findByTestId('marketplace-row-factory-plugins');
    expect(within(row).getByTestId('marketplace-name-factory-plugins')).toHaveTextContent(
      'factory-plugins',
    );
    expect(within(row).getByTestId('marketplace-source-factory-plugins')).toHaveTextContent(
      'Factory-AI/factory-plugins',
    );
    expect(within(row).getByTestId('marketplace-count-factory-plugins')).toHaveTextContent(
      '8 plugins',
    );
  });

  it('shows an error with retry when the daemon does not answer, then recovers', async () => {
    const listMarketplaces = vi
      .fn<() => Promise<Marketplace[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([FACTORY]);
    setup([], { listMarketplaces } as Partial<PluginsApi>);
    expect(await screen.findByTestId('marketplaces-error')).toHaveTextContent(
      'Could not load marketplaces',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('marketplaces-list')).toBeInTheDocument();
  });

  it('switches to the plugin list through the tabs', async () => {
    setup([FACTORY]);
    await screen.findByTestId('marketplaces-list');
    expect(screen.getByTestId('plugins-tab-marketplaces')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('plugins-tab-plugins')).toHaveAttribute(
      'href',
      '/extensions/plugins',
    );
  });
});

describe('MarketplacesScreen add', () => {
  it('rejects an empty or malformed repository inline without calling the daemon', async () => {
    const user = userEvent.setup();
    const { plugins } = setup([]);
    await user.click(await screen.findByTestId('marketplace-add'));
    await user.click(screen.getByTestId('marketplace-add-submit'));
    expect(screen.getByTestId('marketplace-add-repo-error')).toHaveTextContent(
      'Enter a repository.',
    );
    await typeRepo(user, 'not a repo');
    await user.click(screen.getByTestId('marketplace-add-submit'));
    expect(screen.getByTestId('marketplace-add-repo-error')).toHaveTextContent(
      'Use the form owner/repo.',
    );
    expect(screen.getByTestId('marketplace-add-repo')).toHaveValue('not a repo');
    expect(plugins.addMarketplace).not.toHaveBeenCalled();
  });

  it('adds a GitHub marketplace and shows its row and a confirmation', async () => {
    const user = userEvent.setup();
    const { plugins } = setup([]);
    await user.click(await screen.findByTestId('marketplace-add'));
    await typeRepo(user, ' Factory-AI/factory-plugins ');
    await user.click(screen.getByTestId('marketplace-add-submit'));
    await waitFor(() =>
      expect(plugins.addMarketplace).toHaveBeenCalledWith('Factory-AI/factory-plugins'),
    );
    expect(await screen.findByTestId('marketplace-row-factory-plugins')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-add-sheet')).toBeNull();
    expect(screen.getByTestId('marketplaces-notice')).toHaveTextContent('factory-plugins added.');
  });

  it('keeps the form open and shows the daemon error text when the add fails', async () => {
    const user = userEvent.setup();
    const message =
      'Could not download marketplace. HTTPS (https://github.com/Factory-AI/does-not-exist-val.git): Repository not found';
    setup([], {
      addMarketplace: vi.fn(async () => {
        throw new Error(message);
      }),
    } as Partial<PluginsApi>);
    await user.click(await screen.findByTestId('marketplace-add'));
    await typeRepo(user, 'Factory-AI/does-not-exist-val');
    await user.click(screen.getByTestId('marketplace-add-submit'));
    const detail = await screen.findByTestId('marketplace-add-error-detail');
    expect(detail).toHaveTextContent(message);
    expect(screen.getByTestId('marketplace-add-error')).toHaveTextContent(
      'Could not add the marketplace.',
    );
    expect(screen.getByTestId('marketplace-add-submit')).toBeEnabled();
    expect(screen.getByTestId('marketplace-add-submit')).toHaveTextContent('Add marketplace');
    expect(screen.getByTestId('marketplace-add-repo')).toHaveValue('Factory-AI/does-not-exist-val');
    expect(
      within(screen.getByTestId('marketplaces-list')).getByTestId('marketplaces-empty'),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId('marketplace-add-error-dismiss'));
    expect(screen.queryByTestId('marketplace-add-error')).toBeNull();
  });

  it('shows a pending state on the button while the daemon adds', async () => {
    const user = userEvent.setup();
    let release: (name: string) => void = () => {};
    setup([], {
      addMarketplace: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      ),
    } as Partial<PluginsApi>);
    await user.click(await screen.findByTestId('marketplace-add'));
    await typeRepo(user, 'Factory-AI/factory-plugins');
    await user.click(screen.getByTestId('marketplace-add-submit'));
    expect(screen.getByTestId('marketplace-add-submit')).toBeDisabled();
    expect(screen.getByTestId('marketplace-add-submit')).toHaveTextContent('Adding…');
    await act(async () => release('factory-plugins'));
  });

  it('does not show an old add error when the form is opened again', async () => {
    const user = userEvent.setup();
    setup([], {
      addMarketplace: vi.fn(async () => {
        throw new Error('Repository not found');
      }),
    } as Partial<PluginsApi>);
    await user.click(await screen.findByTestId('marketplace-add'));
    await typeRepo(user, 'a/b');
    await user.click(screen.getByTestId('marketplace-add-submit'));
    await screen.findByTestId('marketplace-add-error');
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('marketplace-add'));
    expect(screen.queryByTestId('marketplace-add-error')).toBeNull();
  });
});

describe('MarketplacesScreen update and remove', () => {
  it('shows progress while updating and then the result, keeping the row', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const { plugins } = setup([FACTORY], {
      updateMarketplace: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    } as Partial<PluginsApi>);
    await user.click(await screen.findByTestId('marketplace-update-factory-plugins'));
    expect(plugins.updateMarketplace).toHaveBeenCalledWith('factory-plugins');
    expect(screen.getByTestId('marketplace-pending-factory-plugins')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-update-factory-plugins')).toBeDisabled();
    expect(screen.getByTestId('marketplace-update-factory-plugins')).toHaveTextContent('Updating…');
    await act(async () => release());
    expect(await screen.findByTestId('marketplaces-notice')).toHaveTextContent(
      'factory-plugins updated.',
    );
    expect(screen.getByTestId('marketplace-row-factory-plugins')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-pending-factory-plugins')).toBeNull();
  });

  it('shows the daemon error when an update fails and keeps the row', async () => {
    const user = userEvent.setup();
    setup([FACTORY], {
      updateMarketplace: vi.fn(async () => {
        throw new Error('Marketplace "factory-plugins" not found');
      }),
    } as Partial<PluginsApi>);
    await user.click(await screen.findByTestId('marketplace-update-factory-plugins'));
    expect(await screen.findByTestId('marketplaces-action-error')).toHaveTextContent(
      'Could not update factory-plugins.',
    );
    expect(screen.getByTestId('marketplaces-action-error-detail')).toHaveTextContent(
      'Marketplace "factory-plugins" not found',
    );
    expect(screen.getByTestId('marketplace-row-factory-plugins')).toBeInTheDocument();
  });

  it('asks for confirmation naming the marketplace; Cancel keeps it, Confirm removes it', async () => {
    const user = userEvent.setup();
    const { plugins } = setup([FACTORY]);
    await user.click(await screen.findByTestId('marketplace-remove-factory-plugins'));
    expect(screen.getByTestId('marketplace-remove-dialog')).toHaveTextContent(
      'Remove factory-plugins?',
    );
    await user.click(screen.getByTestId('marketplace-remove-dialog-cancel'));
    expect(plugins.removeMarketplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('marketplace-row-factory-plugins')).toBeInTheDocument();

    await user.click(screen.getByTestId('marketplace-remove-factory-plugins'));
    await user.click(screen.getByTestId('marketplace-remove-dialog-confirm'));
    await waitFor(() => expect(plugins.removeMarketplace).toHaveBeenCalledWith('factory-plugins'));
    expect(await screen.findByTestId('marketplaces-empty')).toBeInTheDocument();
  });

  it('disables Remove for a marketplace the daemon reports as not removable', async () => {
    setup([{ ...FACTORY, removable: false }]);
    expect(await screen.findByTestId('marketplace-remove-factory-plugins')).toBeDisabled();
  });
});
