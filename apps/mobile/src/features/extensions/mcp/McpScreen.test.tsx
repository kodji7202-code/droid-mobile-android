import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionError, DaemonClientError } from '@droidmobile/daemon-client';
import type { DaemonConnection, McpServer, McpTool } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../../test/render-app';
import { useConnectionStore } from '../../../stores/connection';

const openExternal = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../../platform/openExternal', () => ({ openExternal }));
const browserOpen = vi.hoisted(() => vi.fn(async (_options: { url: string }) => {}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: browserOpen } }));
const copyText = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../terminal/clipboard', () => ({ copyText }));

const HTTP: McpServer = {
  name: 'val-http-dummy',
  status: 'failed',
  serverType: 'http',
  source: 'user',
  isManaged: false,
  error: 'Failed to connect to MCP server',
};
const STDIO: McpServer = {
  name: 'val-mcp',
  status: 'connected',
  serverType: 'stdio',
  source: 'user',
  isManaged: false,
  toolCount: 2,
};
const OAUTH: McpServer = {
  name: 'val-oauth-dummy',
  status: 'failed',
  serverType: 'http',
  source: 'user',
  isManaged: false,
  error: 'Authentication required',
  requiresAuth: true,
};

const TOOLS: McpTool[] = [
  { serverName: 'val-mcp', name: 'val_echo', description: 'Echo input', isEnabled: true },
  { serverName: 'val-mcp', name: 'val_time', description: 'Current time', isEnabled: true },
];

type Mcp = DaemonConnection['mcp'];

function setup(initial: McpServer[], overrides: Partial<Mcp> = {}) {
  const state = { servers: initial.map((server) => ({ ...server })) };
  const mcp = {
    listServers: vi.fn(async () => state.servers.map((server) => ({ ...server }))),
    listTools: vi.fn(async (name?: string) =>
      TOOLS.filter((tool) => name === undefined || tool.serverName === name),
    ),
    addServer: vi.fn(async (input: { name: string; type: string }) => {
      state.servers.push({
        name: input.name,
        status: 'failed',
        serverType: input.type,
        source: 'user',
        isManaged: false,
        error: 'Failed to connect to MCP server',
      });
    }),
    toggleServer: vi.fn(async (name: string, enabled: boolean) => {
      const server = state.servers.find((item) => item.name === name);
      if (server) server.status = enabled ? 'failed' : 'disabled';
    }),
    removeServer: vi.fn(async (name: string) => {
      state.servers = state.servers.filter((item) => item.name !== name);
    }),
    clearAuth: vi.fn(async () => {}),
    authenticateServer: vi.fn(() => new Promise<void>(() => {})),
    cancelAuth: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Mcp;
  const connection = { mcp } as unknown as DaemonConnection;
  useConnectionStore.setState({ status: 'ready' });
  renderAppAt('/extensions/mcp', { connection });
  return { state, mcp };
}

beforeEach(() => {
  openExternal.mockClear();
  browserOpen.mockClear();
  copyText.mockClear();
});

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });
});

describe('McpScreen list', () => {
  it('shows a loading state while the daemon list is pending', () => {
    setup([], { listServers: () => new Promise<McpServer[]>(() => {}) });
    expect(screen.getByTestId('mcp-loading')).toBeInTheDocument();
  });

  it('renders one row per daemon server with transport, status, source and error', async () => {
    setup([HTTP, STDIO]);
    const list = await screen.findByTestId('mcp-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByTestId('mcp-transport-val-http-dummy')).toHaveTextContent('http');
    expect(screen.getByTestId('mcp-status-val-http-dummy')).toHaveTextContent('Failed');
    expect(screen.getByTestId('mcp-error-val-http-dummy')).toHaveTextContent(
      'Failed to connect to MCP server',
    );
    expect(screen.getByTestId('mcp-status-val-mcp')).toHaveTextContent('Connected');
    expect(screen.getByTestId('mcp-transport-val-mcp')).toHaveTextContent('stdio');
    expect(screen.getByTestId('mcp-source-val-mcp')).toHaveTextContent('User');
    expect(screen.getByTestId('mcp-tool-count-val-mcp')).toHaveTextContent('2 tools');
  });

  it('shows an empty state with the add action when the daemon has no servers', async () => {
    setup([]);
    expect(await screen.findByTestId('mcp-empty')).toBeInTheDocument();
    expect(within(screen.getByTestId('mcp-list')).getByTestId('mcp-empty')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-add')).toBeInTheDocument();
  });

  it('shows an error with Try again that recovers once the daemon answers', async () => {
    const listServers = vi
      .fn<() => Promise<McpServer[]>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue([STDIO]);
    setup([], { listServers });
    expect(await screen.findByTestId('mcp-error')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('error-state-retry'));
    expect(await screen.findByTestId('mcp-list')).toBeInTheDocument();
  });

  it('shows Authentication required with an Authenticate action instead of Failed', async () => {
    setup([OAUTH]);
    expect(await screen.findByTestId('mcp-status-val-oauth-dummy')).toHaveTextContent(
      'Authentication required',
    );
    expect(screen.getByTestId('mcp-auth-val-oauth-dummy')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-error-val-oauth-dummy')).toBeNull();
  });

  it('releases the scratch session when the section is left', async () => {
    const { mcp } = setup([STDIO]);
    await screen.findByTestId('mcp-list');
    await userEvent.click(screen.getByTestId('nav-settings'));
    await waitFor(() => expect(mcp.release).toHaveBeenCalled(), { timeout: 2000 });
  });
});

describe('McpScreen add', () => {
  it('offers exactly the stdio, http and sse transports', async () => {
    setup([STDIO]);
    await userEvent.click(await screen.findByTestId('mcp-add'));
    const options = within(screen.getByTestId('mcp-add-type'))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['stdio', 'http', 'sse']);
  });

  it('adds an http server and shows the daemon-reported row', async () => {
    const { mcp } = setup([STDIO]);
    await userEvent.click(await screen.findByTestId('mcp-add'));
    await userEvent.selectOptions(screen.getByTestId('mcp-add-type'), 'http');
    await userEvent.type(screen.getByTestId('mcp-add-name'), 'val-http-dummy');
    await userEvent.type(screen.getByTestId('mcp-add-url'), 'http://127.0.0.1:3199/mcp');
    await userEvent.click(screen.getByTestId('mcp-add-submit'));
    expect(mcp.addServer).toHaveBeenCalledWith({
      type: 'http',
      name: 'val-http-dummy',
      url: 'http://127.0.0.1:3199/mcp',
    });
    expect(await screen.findByTestId('mcp-status-val-http-dummy')).toHaveTextContent('Failed');
    expect(screen.queryByTestId('mcp-add-sheet')).toBeNull();
  });

  it('adds a stdio server with parsed args and env', async () => {
    const { mcp } = setup([]);
    await userEvent.click(await screen.findByTestId('mcp-add'));
    await userEvent.type(screen.getByTestId('mcp-add-name'), 'val-stdio-dummy');
    await userEvent.type(screen.getByTestId('mcp-add-command'), 'node');
    await userEvent.click(screen.getByTestId('mcp-add-args'));
    await userEvent.paste('-e "setTimeout(()=>{},500)"');
    await userEvent.type(screen.getByTestId('mcp-add-env'), 'DUMMY_VAR=1');
    await userEvent.click(screen.getByTestId('mcp-add-submit'));
    expect(mcp.addServer).toHaveBeenCalledWith({
      type: 'stdio',
      name: 'val-stdio-dummy',
      command: 'node',
      args: ['-e', 'setTimeout(()=>{},500)'],
      env: { DUMMY_VAR: '1' },
    });
  });

  it('rejects invalid input client-side, keeps the values and sends nothing', async () => {
    const { mcp } = setup([STDIO]);
    await userEvent.click(await screen.findByTestId('mcp-add'));
    const submit = screen.getByTestId('mcp-add-submit');

    await userEvent.selectOptions(screen.getByTestId('mcp-add-type'), 'http');
    await userEvent.type(screen.getByTestId('mcp-add-url'), 'http://127.0.0.1:3199/mcp');
    await userEvent.click(submit);
    expect(screen.getByTestId('mcp-add-name-error')).toHaveTextContent('Enter a name');
    expect(screen.getByTestId('mcp-add-url')).toHaveValue('http://127.0.0.1:3199/mcp');

    await userEvent.type(screen.getByTestId('mcp-add-name'), 'val-mcp');
    await userEvent.click(submit);
    expect(screen.getByTestId('mcp-add-name-error')).toHaveTextContent('already exists');

    await userEvent.clear(screen.getByTestId('mcp-add-name'));
    await userEvent.type(screen.getByTestId('mcp-add-name'), 'fresh');
    await userEvent.clear(screen.getByTestId('mcp-add-url'));
    await userEvent.type(screen.getByTestId('mcp-add-url'), 'not a url');
    await userEvent.click(submit);
    expect(screen.getByTestId('mcp-add-url-error')).toHaveTextContent('valid http');
    expect(screen.getByTestId('mcp-add-name')).toHaveValue('fresh');

    await userEvent.selectOptions(screen.getByTestId('mcp-add-type'), 'stdio');
    await userEvent.click(submit);
    expect(screen.getByTestId('mcp-add-command-error')).toHaveTextContent('Enter a command');

    expect(mcp.addServer).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('mcp-list')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('keeps the sheet open and explains when the daemon rejects the add', async () => {
    setup([], {
      addServer: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await userEvent.click(await screen.findByTestId('mcp-add'));
    await userEvent.type(screen.getByTestId('mcp-add-name'), 'x');
    await userEvent.type(screen.getByTestId('mcp-add-command'), 'node');
    await userEvent.click(screen.getByTestId('mcp-add-submit'));
    expect(await screen.findByTestId('mcp-add-failed')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-add-name')).toHaveValue('x');
  });
});

describe('McpScreen toggle', () => {
  it('is on for a failed server, off for a disabled one, and follows the daemon', async () => {
    const { mcp, state } = setup([HTTP]);
    const toggle = await screen.findByTestId('mcp-toggle-val-http-dummy');
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(mcp.toggleServer).toHaveBeenCalledWith('val-http-dummy', false);
    await waitFor(() =>
      expect(screen.getByTestId('mcp-status-val-http-dummy')).toHaveTextContent('Disabled'),
    );
    expect(screen.getByTestId('mcp-toggle-val-http-dummy')).not.toBeChecked();
    expect(state.servers[0]?.status).toBe('disabled');
    await userEvent.click(screen.getByTestId('mcp-toggle-val-http-dummy'));
    expect(mcp.toggleServer).toHaveBeenLastCalledWith('val-http-dummy', true);
    await waitFor(() =>
      expect(screen.getByTestId('mcp-status-val-http-dummy')).toHaveTextContent('Failed'),
    );
  });

  it('disables the control while the request is in flight', async () => {
    let release: () => void = () => {};
    setup([HTTP], {
      toggleServer: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    });
    await userEvent.click(await screen.findByTestId('mcp-toggle-val-http-dummy'));
    expect(screen.getByTestId('mcp-toggle-val-http-dummy')).toBeDisabled();
    expect(screen.getByTestId('mcp-pending-val-http-dummy')).toBeInTheDocument();
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('mcp-toggle-val-http-dummy')).toBeEnabled());
  });

  it('shows an error and keeps the daemon state when the toggle is rejected', async () => {
    setup([HTTP], {
      toggleServer: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    await userEvent.click(await screen.findByTestId('mcp-toggle-val-http-dummy'));
    expect(await screen.findByTestId('mcp-action-error')).toHaveTextContent('val-http-dummy');
    expect(screen.getByTestId('mcp-toggle-val-http-dummy')).toBeChecked();
  });
});

describe('McpScreen remove', () => {
  it('asks for confirmation naming the server; cancel keeps the row', async () => {
    const { mcp } = setup([HTTP]);
    await userEvent.click(await screen.findByTestId('mcp-remove-val-http-dummy'));
    expect(screen.getByTestId('mcp-remove-dialog')).toHaveTextContent('val-http-dummy');
    await userEvent.click(screen.getByTestId('mcp-remove-dialog-cancel'));
    expect(screen.queryByTestId('mcp-remove-dialog')).toBeNull();
    expect(mcp.removeServer).not.toHaveBeenCalled();
    expect(screen.getByTestId('mcp-row-val-http-dummy')).toBeInTheDocument();
  });

  it('removes the server after confirmation', async () => {
    const { mcp } = setup([HTTP, STDIO]);
    await userEvent.click(await screen.findByTestId('mcp-remove-val-http-dummy'));
    await userEvent.click(screen.getByTestId('mcp-remove-dialog-confirm'));
    expect(mcp.removeServer).toHaveBeenCalledWith('val-http-dummy');
    await waitFor(() => expect(screen.queryByTestId('mcp-row-val-http-dummy')).toBeNull());
    expect(mcp.clearAuth).not.toHaveBeenCalled();
    expect(screen.getByTestId('mcp-row-val-mcp')).toBeInTheDocument();
  });

  it('clears stored sign-in before removing an OAuth server', async () => {
    const { mcp } = setup([OAUTH]);
    await userEvent.click(await screen.findByTestId('mcp-remove-val-oauth-dummy'));
    await userEvent.click(screen.getByTestId('mcp-remove-dialog-confirm'));
    await waitFor(() => expect(mcp.removeServer).toHaveBeenCalledWith('val-oauth-dummy'));
    expect(mcp.clearAuth).toHaveBeenCalledWith('val-oauth-dummy');
  });
});

describe('McpScreen OAuth', () => {
  const URL = 'https://mcp.linear.app/authorize?state=SECRETSTATE&code_challenge=SECRETCHALLENGE';

  function withPendingUrl(state: { servers: McpServer[] }) {
    const server = state.servers[0];
    if (server) server.pendingAuthUrl = URL;
  }

  it('starts authentication and shows only the host with open, copy and cancel', async () => {
    const { mcp, state } = setup([OAUTH]);
    await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
    expect(mcp.authenticateServer).toHaveBeenCalledWith('val-oauth-dummy');
    expect(await screen.findByTestId('mcp-auth-panel-val-oauth-dummy')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-auth-open-val-oauth-dummy')).toBeNull();

    withPendingUrl(state);
    expect(
      await screen.findByTestId('mcp-auth-host-val-oauth-dummy', undefined, { timeout: 3000 }),
    ).toHaveTextContent('mcp.linear.app');
    expect(document.body.textContent).not.toContain('SECRETSTATE');
    expect(document.body.textContent).not.toContain('SECRETCHALLENGE');

    await userEvent.click(screen.getByTestId('mcp-auth-open-val-oauth-dummy'));
    expect(openExternal).toHaveBeenCalledWith(URL);
    await userEvent.click(screen.getByTestId('mcp-auth-copy-val-oauth-dummy'));
    expect(copyText).toHaveBeenCalledWith(URL);
  });

  describe('automatic open of the authorization page', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('opens it once per Authenticate on Android, not again on later polls, and keeps the panel', async () => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      const { mcp, state } = setup([OAUTH]);
      await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
      expect(browserOpen).not.toHaveBeenCalled();

      withPendingUrl(state);
      await waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(1), { timeout: 3000 });
      expect(browserOpen).toHaveBeenCalledWith({ url: URL });
      expect(mcp.authenticateServer).toHaveBeenCalledTimes(1);

      const polls = vi.mocked(mcp.listServers).mock.calls.length;
      await waitFor(
        () => expect(vi.mocked(mcp.listServers).mock.calls.length).toBeGreaterThan(polls + 1),
        {
          timeout: 4000,
        },
      );
      expect(browserOpen).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('mcp-auth-open-val-oauth-dummy')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-auth-cancel-val-oauth-dummy')).toBeInTheDocument();
    }, 10000);

    it('opens it again for a new Authenticate after cancelling', async () => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      const { mcp, state } = setup([OAUTH]);
      await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
      withPendingUrl(state);
      await waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(1), { timeout: 3000 });
      await userEvent.click(screen.getByTestId('mcp-auth-cancel-val-oauth-dummy'));
      expect(mcp.cancelAuth).toHaveBeenCalledWith('val-oauth-dummy');
      await waitFor(() =>
        expect(screen.queryByTestId('mcp-auth-panel-val-oauth-dummy')).toBeNull(),
      );

      await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
      await waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(2), { timeout: 3000 });
    }, 10000);

    it('does not open it on the web; the panel offers the explicit button', async () => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
      const { state } = setup([OAUTH]);
      await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
      withPendingUrl(state);
      expect(
        await screen.findByTestId('mcp-auth-open-val-oauth-dummy', undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(browserOpen).not.toHaveBeenCalled();
    });
  });

  it('cancel calls cancelAuth, removes the panel and returns to Authentication required', async () => {
    const { mcp, state } = setup([OAUTH]);
    await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
    withPendingUrl(state);
    await userEvent.click(
      await screen.findByTestId('mcp-auth-cancel-val-oauth-dummy', undefined, { timeout: 3000 }),
    );
    expect(mcp.cancelAuth).toHaveBeenCalledWith('val-oauth-dummy');
    await waitFor(() => expect(screen.queryByTestId('mcp-auth-panel-val-oauth-dummy')).toBeNull());
    delete state.servers[0]?.pendingAuthUrl;
    expect(screen.getByTestId('mcp-status-val-oauth-dummy')).toHaveTextContent(
      'Authentication required',
    );
    expect(screen.getByTestId('mcp-auth-val-oauth-dummy')).toBeEnabled();
  });

  describe('after the daemon socket dropped while the browser was in front', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function interruptible() {
      const control = { drop: () => {} };
      const mcp = {
        authenticateServer: vi.fn(
          () =>
            new Promise<void>((_, reject) => {
              control.drop = () => reject(new ConnectionError('Client destroyed'));
            }),
        ),
      };
      return { control, mcp };
    }

    async function startAndDrop(control: { drop: () => void }, state: { servers: McpServer[] }) {
      await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
      withPendingUrl(state);
      await screen.findByTestId('mcp-auth-host-val-oauth-dummy', undefined, { timeout: 3000 });
      await act(async () => control.drop());
    }

    it('keeps the pending panel without a sign-in error and cancels through the same client', async () => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      const { control, mcp: overrides } = interruptible();
      const { mcp, state } = setup([OAUTH], overrides);
      await startAndDrop(control, state);
      await waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(1));

      expect(screen.queryByTestId('mcp-action-error')).toBeNull();
      expect(screen.getByTestId('mcp-auth-host-val-oauth-dummy')).toHaveTextContent(
        'mcp.linear.app',
      );
      expect(screen.getByTestId('mcp-auth-open-val-oauth-dummy')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('mcp-auth-cancel-val-oauth-dummy'));
      expect(mcp.cancelAuth).toHaveBeenCalledWith('val-oauth-dummy');
      await waitFor(() =>
        expect(screen.queryByTestId('mcp-auth-panel-val-oauth-dummy')).toBeNull(),
      );
      delete state.servers[0]?.pendingAuthUrl;
      expect(screen.queryByTestId('mcp-action-error')).toBeNull();
      expect(screen.getByTestId('mcp-status-val-oauth-dummy')).toHaveTextContent(
        'Authentication required',
      );
      expect(screen.getByTestId('mcp-auth-val-oauth-dummy')).toBeEnabled();
    }, 10000);

    it('restores the panel after the reconnect reload without opening the browser again', async () => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      const { control, mcp: overrides } = interruptible();
      const { state } = setup([OAUTH], overrides);
      await startAndDrop(control, state);
      await waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(1));

      act(() => {
        useConnectionStore.setState({ readyEpoch: useConnectionStore.getState().readyEpoch + 1 });
      });
      expect(
        await screen.findByTestId('mcp-auth-host-val-oauth-dummy', undefined, { timeout: 3000 }),
      ).toHaveTextContent('mcp.linear.app');
      expect(screen.getByTestId('mcp-auth-cancel-val-oauth-dummy')).toBeInTheDocument();
      expect(screen.queryByTestId('mcp-action-error')).toBeNull();
      expect(browserOpen).toHaveBeenCalledTimes(1);
    }, 10000);

    it('drops the panel quietly once the daemon no longer holds the sign-in', async () => {
      const { control, mcp: overrides } = interruptible();
      const { state } = setup([OAUTH], overrides);
      await startAndDrop(control, state);
      expect(screen.getByTestId('mcp-auth-panel-val-oauth-dummy')).toBeInTheDocument();

      delete state.servers[0]?.pendingAuthUrl;
      await waitFor(
        () => expect(screen.queryByTestId('mcp-auth-panel-val-oauth-dummy')).toBeNull(),
        {
          timeout: 3000,
        },
      );
      expect(screen.queryByTestId('mcp-action-error')).toBeNull();
      expect(screen.getByTestId('mcp-auth-val-oauth-dummy')).toBeEnabled();
    }, 10000);

    it('still reports a daemon-side sign-in failure', async () => {
      setup([OAUTH], {
        authenticateServer: vi.fn(async () => {
          throw new DaemonClientError('unknown', 'Authorization was cancelled');
        }),
      });
      await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
      expect(await screen.findByTestId('mcp-action-error')).toBeInTheDocument();
      expect(screen.queryByTestId('mcp-auth-panel-val-oauth-dummy')).toBeNull();
    });
  });

  it('surfaces a failed sign-in start without a panel', async () => {
    setup([OAUTH], {
      authenticateServer: vi.fn(async () => {
        throw new Error('denied');
      }),
    });
    await userEvent.click(await screen.findByTestId('mcp-auth-val-oauth-dummy'));
    expect(await screen.findByTestId('mcp-action-error')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-auth-panel-val-oauth-dummy')).toBeNull();
  });
});

describe('McpDetail', () => {
  it('lists the tools of a connected server with descriptions and a count', async () => {
    const { mcp } = setup([HTTP, STDIO]);
    await userEvent.click(await screen.findByTestId('mcp-open-val-mcp'));
    const list = await screen.findByTestId('mcp-tools-list');
    expect(mcp.listTools).toHaveBeenCalledWith('val-mcp');
    const names = within(list)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('[data-testid^="mcp-tool-name-"]')?.textContent);
    expect(names).toEqual(['val_echo', 'val_time']);
    expect(within(list).getByText('Echo input')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-tools-count')).toHaveTextContent('2');
  });

  it('shows an explicit no-tools state with the error text for a failed server', async () => {
    setup([HTTP, STDIO]);
    await userEvent.click(await screen.findByTestId('mcp-open-val-http-dummy'));
    const empty = await screen.findByTestId('mcp-tools-empty');
    expect(empty).toHaveTextContent('No tools available');
    expect(screen.getByTestId('mcp-detail-error')).toHaveTextContent(
      'Failed to connect to MCP server',
    );
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
  });
});
