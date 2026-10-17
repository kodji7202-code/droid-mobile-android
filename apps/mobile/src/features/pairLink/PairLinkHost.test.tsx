import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { createDaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { createAppRoutes } from '../../app/routes';
import { MissingKeyError, useConnectionStore } from '../../stores/connection';
import { loadSavedConnections } from '../../platform/savedConnections';
import { changeAppLanguage } from '../../i18n/init';
import { PairLinkHost } from './PairLinkHost';
import { resetPairLinkMemory, usePairLinkStore } from './pairLinkStore';

const FAKE_KEY = 'fk-fakefakefake0001';
const BRIDGE_SECRET = 'bridge-secret-probe';
const URL_ONLY = 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101';
const WITH_KEY = `${URL_ONLY}&key=${FAKE_KEY}&bridge=https%3A%2F%2Fbridge.example.invalid&bridgeSecret=${BRIDGE_SECRET}`;
const OTHER_HOST = 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3109';
const OTHER_HOST_KEY = `${OTHER_HOST}&key=${FAKE_KEY}`;
const FIRST = { id: 'a', label: 'First', url: 'ws://10.0.2.2:3101' };

const connectMock = vi.fn();
vi.mock('@droidmobile/daemon-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@droidmobile/daemon-client')>();
  return {
    ...actual,
    createDaemonConnection: vi.fn(() => ({
      connect: (...args: unknown[]) => connectMock(...args),
      disconnect: vi.fn(),
      onStatus: () => () => undefined,
      onWarning: () => () => undefined,
      getStatus: () => 'connecting',
    })),
  };
});

const actions = {
  addConnection: vi.fn(),
  switchTo: vi.fn(),
  updateConnection: vi.fn(),
};

function renderHost(path: string) {
  const router = createMemoryRouter(createAppRoutes(), { initialEntries: [path] });
  return {
    router,
    ...render(
      <AppProviders>
        <>
          <RouterProvider router={router} />
          <PairLinkHost navigate={(to) => void router.navigate(to)} />
        </>
      </AppProviders>,
    ),
  };
}

function receive(link: string) {
  act(() => usePairLinkStore.getState().receive(link));
}

beforeEach(() => {
  connectMock.mockReset().mockResolvedValue(undefined);
  vi.mocked(createDaemonConnection).mockClear();
  for (const fn of Object.values(actions)) fn.mockReset();
  window.localStorage.clear();
  resetPairLinkMemory();
  usePairLinkStore.setState({ pending: null, notice: null, forConnect: null, forAddForm: null });
  useConnectionStore.setState({
    connection: null,
    status: 'offline',
    activeConnectionId: null,
    savedConnections: [],
    savedActiveId: null,
  });
});

afterEach(async () => {
  await changeAppLanguage('en');
});

describe('PairLinkHost dialog', () => {
  it('shows host and key status, never the key or the bridge secret, and opens no socket', () => {
    renderHost('/connect');
    receive(WITH_KEY);
    expect(screen.getByTestId('pair-link-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('pair-link-host')).toHaveTextContent('10.0.2.2:3101');
    expect(screen.getByTestId('pair-link-key')).toHaveAttribute('data-included', 'true');
    expect(screen.getByTestId('pair-link-key')).toHaveTextContent(/included in the link/i);
    expect(screen.getByTestId('pair-link-bridge')).toHaveTextContent('bridge.example.invalid');
    const markup = document.body.innerHTML;
    expect(markup).not.toContain(FAKE_KEY);
    expect(markup).not.toContain(BRIDGE_SECRET);
    expect(createDaemonConnection).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBe(
      screen.getByTestId('pair-link-confirm'),
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(
      screen.getByTestId('pair-link-cancel'),
    );
  });

  it('states that a URL-only link has no key and omits the bridge row', () => {
    renderHost('/connect');
    receive(URL_ONLY);
    expect(screen.getByTestId('pair-link-key')).toHaveAttribute('data-included', 'false');
    expect(screen.getByTestId('pair-link-key')).toHaveTextContent(/not included/i);
    expect(screen.queryByTestId('pair-link-bridge')).not.toBeInTheDocument();
  });

  it('localizes the dialog', async () => {
    await changeAppLanguage('ro');
    renderHost('/connect');
    receive(URL_ONLY);
    expect(screen.getByTestId('pair-link-key')).toHaveTextContent('Nu este inclusă');
    expect(screen.getByTestId('pair-link-confirm')).toHaveTextContent('Continuă');
  });

  it('shows one dialog for repeated deliveries and none after cancel', () => {
    renderHost('/connect');
    receive(URL_ONLY);
    receive(URL_ONLY);
    expect(screen.getAllByTestId('pair-link-dialog')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('pair-link-cancel'));
    expect(screen.queryByTestId('pair-link-dialog')).not.toBeInTheDocument();
  });

  it('cancel stores nothing and opens no connection', () => {
    renderHost('/connect');
    receive(WITH_KEY);
    fireEvent.click(screen.getByTestId('pair-link-cancel'));
    expect(createDaemonConnection).not.toHaveBeenCalled();
    expect(loadSavedConnections().connections).toEqual([]);
    expect(screen.getByTestId('connect-url-input')).toHaveValue('');
    expect(screen.getByTestId('connect-key-input')).toHaveValue('');
    expect(usePairLinkStore.getState().forConnect).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('shows a localized error and no dialog for an invalid link', async () => {
    renderHost('/connect');
    receive('droidmobile://pair?v=2&url=wss%3A%2F%2Fx.example.invalid');
    expect(screen.queryByTestId('pair-link-dialog')).not.toBeInTheDocument();
    expect(await screen.findByTestId('toast')).toHaveTextContent('This pairing link is not valid.');
    expect(document.body.innerHTML).not.toContain('v=2&url=');
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });
});

describe('PairLinkHost confirm without a connection', () => {
  it('fills the URL of a URL-only link, focuses the key field and does not connect', async () => {
    renderHost('/connect');
    receive(URL_ONLY);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    expect(screen.queryByTestId('pair-link-dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('connect-url-input')).toHaveValue('ws://10.0.2.2:3101'),
    );
    expect(screen.getByTestId('connect-key-input')).toHaveFocus();
    expect(screen.getByTestId('connect-key-input')).toHaveValue('');
    expect(screen.getByTestId('connect-submit')).toBeDisabled();
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });

  it('starts one connection for a link with a key and, when rejected, saves nothing and drops the key', async () => {
    connectMock.mockRejectedValue(Object.assign(new Error('rejected'), { kind: 'auth' }));
    renderHost('/connect');
    receive(WITH_KEY);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    expect(await screen.findByTestId('connect-error')).toHaveTextContent(/rejected this API key/);
    expect(createDaemonConnection).toHaveBeenCalledTimes(1);
    expect(loadSavedConnections().connections).toEqual([]);
    expect(screen.getByTestId('connect-key-input')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(FAKE_KEY);
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const name = window.localStorage.key(i) ?? '';
      expect(window.localStorage.getItem(name)).not.toContain(FAKE_KEY);
    }
  });

  it('applies a link that arrives while the Connect screen is not yet mounted', async () => {
    const { router } = renderHost('/settings');
    receive(URL_ONLY);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/connect'));
    await waitFor(() =>
      expect(screen.getByTestId('connect-url-input')).toHaveValue('ws://10.0.2.2:3101'),
    );
  });
});

describe('PairLinkHost confirm with an active connection', () => {
  beforeEach(() => {
    window.localStorage.setItem(
      'droidmobile.connections',
      JSON.stringify({ activeId: 'a', connections: [FIRST] }),
    );
    useConnectionStore.setState({
      ...actions,
      connection: {} as DaemonConnection,
      status: 'ready',
      activeConnectionId: 'a',
      savedConnections: [FIRST],
      savedActiveId: 'a',
    });
  });

  it('opens the add form prefilled for a URL-only link to another host and keeps the current connection', async () => {
    const { router } = renderHost('/sessions');
    receive(OTHER_HOST);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/connection'));
    expect(await screen.findByTestId('connection-form-url')).toHaveValue('ws://10.0.2.2:3109');
    expect(actions.switchTo).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().connection).not.toBeNull();

    actions.addConnection.mockResolvedValue({ id: 'n', label: 'x', url: 'ws://10.0.2.2:3109' });
    actions.switchTo.mockResolvedValue(undefined);
    fireEvent.change(screen.getByTestId('connection-form-key'), { target: { value: FAKE_KEY } });
    fireEvent.click(screen.getByTestId('connection-form-submit'));
    await waitFor(() => expect(actions.switchTo).toHaveBeenCalledWith('n'));
    expect(actions.addConnection).toHaveBeenCalledWith({
      label: '',
      url: 'ws://10.0.2.2:3109',
      apiKey: FAKE_KEY,
    });
  });

  it('adds and switches for a link with a key to another host', async () => {
    actions.addConnection.mockResolvedValue({ id: 'n', label: 'x', url: 'ws://10.0.2.2:3109' });
    actions.switchTo.mockResolvedValue(undefined);
    const { router } = renderHost('/settings');
    receive(OTHER_HOST_KEY);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    await waitFor(() => expect(actions.switchTo).toHaveBeenCalledWith('n'));
    expect(actions.addConnection).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/sessions');
    expect(await screen.findByTestId('toast')).toHaveTextContent('10.0.2.2:3109');
  });

  it('switches to the saved entry for the same host without adding a duplicate', async () => {
    actions.switchTo.mockResolvedValue(undefined);
    renderHost('/sessions');
    receive(URL_ONLY);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    await waitFor(() => expect(actions.switchTo).toHaveBeenCalledWith('a'));
    expect(actions.addConnection).not.toHaveBeenCalled();
    expect(actions.updateConnection).not.toHaveBeenCalled();
  });

  it('updates the stored key for the same host and switches', async () => {
    actions.updateConnection.mockResolvedValue(undefined);
    actions.switchTo.mockResolvedValue(undefined);
    renderHost('/sessions');
    receive(`${URL_ONLY}&key=${FAKE_KEY}`);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    await waitFor(() => expect(actions.switchTo).toHaveBeenCalledWith('a'));
    expect(actions.updateConnection).toHaveBeenCalledWith('a', {
      label: 'First',
      url: 'ws://10.0.2.2:3101',
      apiKey: FAKE_KEY,
    });
    expect(actions.addConnection).not.toHaveBeenCalled();
  });

  it('shows the key-specific error when the daemon rejects the key and changes nothing else', async () => {
    actions.addConnection.mockRejectedValue(Object.assign(new Error('rejected'), { kind: 'auth' }));
    renderHost('/sessions');
    receive(OTHER_HOST_KEY);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    expect(await screen.findByTestId('toast')).toHaveTextContent(/rejected this API key/);
    expect(actions.switchTo).not.toHaveBeenCalled();
  });

  it('explains a missing stored key when switching to a saved host without one', async () => {
    actions.switchTo.mockRejectedValue(new MissingKeyError());
    renderHost('/sessions');
    receive(URL_ONLY);
    fireEvent.click(screen.getByTestId('pair-link-confirm'));
    expect(await screen.findByTestId('toast')).toHaveTextContent(/not stored on this device/);
  });
});
