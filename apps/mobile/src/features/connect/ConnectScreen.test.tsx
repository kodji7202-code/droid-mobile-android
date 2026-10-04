import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { getSecureStore } from '../../platform/secureStore';
import { loadSavedConnections } from '../../platform/savedConnections';
import { createDaemonConnection } from '@droidmobile/daemon-client';

const PROBE_KEY = 'fk-invalid-validation-probe';
const connectMock = vi.fn();
const disconnectMock = vi.fn();
const onStatusMock = vi.fn(() => () => undefined);

vi.mock('@droidmobile/daemon-client', () => ({
  createDaemonConnection: vi.fn(() => ({
    connect: (...args: unknown[]) => connectMock(...args),
    disconnect: disconnectMock,
    onStatus: onStatusMock,
    getStatus: () => 'connecting',
  })),
}));

function renderConnect() {
  return renderAppAt('/connect', { connected: false });
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, url: string, key: string) {
  await user.clear(screen.getByTestId('connect-url-input'));
  if (url !== '') await user.type(screen.getByTestId('connect-url-input'), url);
  await user.clear(screen.getByTestId('connect-key-input'));
  if (key !== '') await user.type(screen.getByTestId('connect-key-input'), key);
  await user.click(screen.getByTestId('connect-submit'));
}

describe('ConnectScreen', () => {
  beforeEach(() => {
    connectMock.mockReset();
    connectMock.mockResolvedValue(undefined);
    disconnectMock.mockReset();
    onStatusMock.mockClear();
    vi.mocked(createDaemonConnection).mockClear();
    useConnectionStore.setState({ connection: null, status: 'offline', activeConnectionId: null });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows only the connect screen without a connection, redirecting shell routes', () => {
    renderAppAt('/sessions', { connected: false });
    expect(screen.getByTestId('connect-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('connect-key-input')).toBeInTheDocument();
    expect(screen.getByTestId('connect-scan-qr')).toBeInTheDocument();
    expect(screen.getByTestId('connect-submit')).toBeDisabled();
    expect(screen.queryByTestId('nav-sessions')).not.toBeInTheDocument();
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });

  it('disables submit until both fields are non-blank and masks the key', async () => {
    const user = userEvent.setup();
    renderConnect();
    const submit = screen.getByTestId('connect-submit');
    await user.type(screen.getByTestId('connect-url-input'), 'ws://127.0.0.1:3101');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('connect-key-input'), '   ');
    expect(submit).toBeDisabled();
    await user.clear(screen.getByTestId('connect-key-input'));
    await user.type(screen.getByTestId('connect-key-input'), PROBE_KEY);
    expect(submit).toBeEnabled();
    expect(screen.getByTestId('connect-key-input')).toHaveAttribute('type', 'password');
  });

  it('rejects a malformed key inline without constructing a connection, then clears on edit', async () => {
    const user = userEvent.setup();
    renderConnect();
    await fillAndSubmit(user, 'ws://127.0.0.1:3101', 'not-a-key');
    expect(screen.getByTestId('connect-error')).toHaveTextContent(/API key/i);
    expect(screen.getByTestId('connect-key-input')).toHaveValue('not-a-key');
    expect(createDaemonConnection).not.toHaveBeenCalled();
    await user.clear(screen.getByTestId('connect-key-input'));
    await user.type(screen.getByTestId('connect-key-input'), PROBE_KEY);
    expect(screen.queryByTestId('connect-error')).not.toBeInTheDocument();
  });

  it.each(['daemon', 'ws://', 'ftp://127.0.0.1:3101'])(
    'rejects the malformed URL %s mentioning ws:// or wss:// without connecting',
    async (badUrl) => {
      const user = userEvent.setup();
      renderConnect();
      await fillAndSubmit(user, badUrl, PROBE_KEY);
      expect(screen.getByTestId('connect-error')).toHaveTextContent(/wss?:\/\//);
      expect(createDaemonConnection).not.toHaveBeenCalled();
      await user.clear(screen.getByTestId('connect-url-input'));
      await user.type(screen.getByTestId('connect-url-input'), 'ws://127.0.0.1:3101');
      expect(screen.queryByTestId('connect-error')).not.toBeInTheDocument();
    },
  );

  it('shows the insecure banner for ws:// in debug builds only', async () => {
    const user = userEvent.setup();
    renderConnect();
    expect(screen.queryByTestId('connect-insecure-banner')).not.toBeInTheDocument();
    await user.type(screen.getByTestId('connect-url-input'), 'ws://127.0.0.1:3101');
    expect(screen.getByTestId('connect-insecure-banner')).toHaveTextContent(/not encrypted/i);
    await user.clear(screen.getByTestId('connect-url-input'));
    await user.type(screen.getByTestId('connect-url-input'), 'wss://example.invalid');
    expect(screen.queryByTestId('connect-insecure-banner')).not.toBeInTheDocument();
  });

  it('release builds refuse ws:// before any connection exists and never show the banner', async () => {
    vi.stubEnv('VITE_DROID_BUILD', 'release');
    const user = userEvent.setup();
    renderConnect();
    await user.type(screen.getByTestId('connect-url-input'), 'ws://127.0.0.1:3101');
    expect(screen.queryByTestId('connect-insecure-banner')).not.toBeInTheDocument();
    await fillAndSubmit(user, 'ws://127.0.0.1:3101', PROBE_KEY);
    expect(screen.getByTestId('connect-error')).toHaveTextContent(/wss:\/\//);
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });

  it('connects once, saves metadata plus an in-memory key, and lands on Sessions', async () => {
    const user = userEvent.setup();
    renderConnect();
    await fillAndSubmit(user, 'ws://127.0.0.1:3101', PROBE_KEY);
    await waitFor(() => expect(screen.getByTestId('sessions-screen')).toBeInTheDocument());
    expect(createDaemonConnection).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
    const saved = loadSavedConnections();
    expect(saved.connections).toHaveLength(1);
    expect(saved.connections[0]?.url).toBe('ws://127.0.0.1:3101');
    expect(JSON.stringify(window.localStorage)).not.toContain(PROBE_KEY);
    const id = useConnectionStore.getState().activeConnectionId;
    expect(await getSecureStore().getSecret(id ?? '')).toBe(PROBE_KEY);
  });

  it('a double click opens one connection', async () => {
    let resolve: () => void = () => undefined;
    connectMock.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const user = userEvent.setup();
    renderConnect();
    await user.type(screen.getByTestId('connect-url-input'), 'ws://127.0.0.1:3101');
    await user.type(screen.getByTestId('connect-key-input'), PROBE_KEY);
    await user.dblClick(screen.getByTestId('connect-submit'));
    expect(screen.getByTestId('connect-submit')).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByTestId('sessions-screen')).toBeInTheDocument());
    expect(createDaemonConnection).toHaveBeenCalledTimes(1);
  });

  it('shows a key-specific error for a rejected key and saves nothing', async () => {
    connectMock.mockRejectedValue(Object.assign(new Error('x'), { kind: 'auth' }));
    const user = userEvent.setup();
    renderConnect();
    await fillAndSubmit(user, 'ws://127.0.0.1:3101', PROBE_KEY);
    await waitFor(() => expect(screen.getByTestId('connect-error')).toHaveTextContent(/rejected/i));
    expect(screen.getByTestId('connect-error')).not.toHaveTextContent(/internal error/i);
    expect(screen.getByTestId('connect-submit')).toBeEnabled();
    expect(loadSavedConnections().connections).toHaveLength(0);
    expect(useConnectionStore.getState().connection).toBeNull();
  });

  it('shows a different message when the host is unreachable and allows a retry', async () => {
    connectMock.mockRejectedValueOnce(Object.assign(new Error('x'), { kind: 'connection' }));
    const user = userEvent.setup();
    renderConnect();
    await fillAndSubmit(user, 'ws://127.0.0.1:3199', PROBE_KEY);
    await waitFor(() => expect(screen.getByTestId('connect-error')).toHaveTextContent(/reach a droid daemon/i));
    expect(screen.getByTestId('connect-error')).not.toHaveTextContent(/rejected/i);
    expect(screen.getByTestId('connect-url-input')).toBeEnabled();
    await user.click(screen.getByTestId('connect-submit'));
    await waitFor(() => expect(screen.getByTestId('sessions-screen')).toBeInTheDocument());
  });
});

describe('ConnectScreen pairing paste', () => {
  beforeEach(() => {
    vi.mocked(createDaemonConnection).mockClear();
    useConnectionStore.setState({ connection: null, status: 'offline', activeConnectionId: null });
    window.localStorage.clear();
  });

  it('exposes the pairing field under the accessible name "Paste pairing code"', () => {
    renderConnect();
    expect(screen.getByRole('textbox', { name: 'Paste pairing code' })).toBe(
      screen.getByTestId('connect-paste-pairing'),
    );
  });

  it('fills URL and key from a valid code and clears the pairing field', () => {
    renderConnect();
    const code = `droidmobile://pair?v=1&url=ws%3A%2F%2F127.0.0.1%3A3101&key=${PROBE_KEY}`;
    fireEvent.change(screen.getByTestId('connect-paste-pairing'), { target: { value: code } });
    expect(screen.getByTestId('connect-url-input')).toHaveValue('ws://127.0.0.1:3101');
    expect(screen.getByTestId('connect-key-input')).toHaveValue(PROBE_KEY);
    expect(screen.getByTestId('connect-key-input')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('connect-paste-pairing')).toHaveValue('');
    expect(document.body.innerText ?? document.body.textContent).not.toContain(PROBE_KEY);
    expect(screen.getByTestId('connect-submit')).toBeEnabled();
  });

  it.each([
    'hello',
    'https://example.com',
    'droidmobile://pair?v=2&url=wss://x.example.invalid',
    'droidmobile://pair?v=1',
    'droidmobile://pair?v=1&url=ftp://x.example.invalid',
  ])('rejects %s and leaves the fields unchanged', (value) => {
    renderConnect();
    fireEvent.change(screen.getByTestId('connect-url-input'), { target: { value: 'ws://keep:1' } });
    fireEvent.change(screen.getByTestId('connect-paste-pairing'), { target: { value } });
    expect(screen.getByTestId('connect-pairing-error')).toHaveTextContent(/not a valid pairing code/i);
    expect(screen.getByTestId('connect-url-input')).toHaveValue('ws://keep:1');
    expect(screen.getByTestId('connect-key-input')).toHaveValue('');
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });
});
