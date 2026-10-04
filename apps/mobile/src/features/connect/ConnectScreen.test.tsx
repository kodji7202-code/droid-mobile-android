import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { getSecureStore } from '../../platform/secureStore';
import { loadSavedConnections, saveActiveConnection } from '../../platform/savedConnections';
import { createDaemonConnection } from '@droidmobile/daemon-client';
import { qrScanner } from '../../platform/qrScanner';
import type { QrScanResult } from '../../platform/qrScanner';

const PROBE_KEY = 'fk-invalid-validation-probe';
vi.mock('../../platform/qrScanner', () => ({
  qrScanner: {
    isSupported: () => true,
    scanCamera: vi.fn(),
    scanImage: vi.fn(),
    stopCamera: vi.fn(),
  },
}));

const connectMock = vi.fn();
const disconnectMock = vi.fn();
const onStatusMock = vi.fn(() => () => undefined);

vi.mock('@droidmobile/daemon-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@droidmobile/daemon-client')>();
  return {
    ...actual,
    createDaemonConnection: vi.fn(() => ({
      connect: (...args: unknown[]) => connectMock(...args),
      disconnect: disconnectMock,
      onStatus: onStatusMock,
      onWarning: () => () => undefined,
      getStatus: () => 'connecting',
    })),
  };
});

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

  it('lists the saved connection label while it awaits its key, without dialling', () => {
    saveActiveConnection({ id: 'w1', label: 'Work PC', url: 'ws://127.0.0.1:3101' });
    renderConnect();
    expect(screen.getByTestId('connect-saved-connection')).toHaveTextContent('Work PC');
    expect(screen.getByTestId('connect-saved-connection')).toHaveTextContent('ws://127.0.0.1:3101');
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });

  it('shows no saved connection hint when nothing is saved', () => {
    renderConnect();
    expect(screen.queryByTestId('connect-saved-connection')).not.toBeInTheDocument();
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
    await waitFor(() =>
      expect(screen.getByTestId('connect-error')).toHaveTextContent(/reach a droid daemon/i),
    );
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
    'droidmobile://pair?v=1&url=ws%3A%2F%2F127.0.0.1%3A3101%23',
  ])('rejects %s and leaves the fields unchanged', (value) => {
    renderConnect();
    fireEvent.change(screen.getByTestId('connect-url-input'), { target: { value: 'ws://keep:1' } });
    fireEvent.change(screen.getByTestId('connect-paste-pairing'), { target: { value } });
    expect(screen.getByTestId('connect-pairing-error')).toHaveTextContent(
      /not a valid pairing code/i,
    );
    expect(screen.getByTestId('connect-url-input')).toHaveValue('ws://keep:1');
    expect(screen.getByTestId('connect-key-input')).toHaveValue('');
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });
});

describe('ConnectScreen QR scanning', () => {
  beforeEach(() => {
    vi.mocked(createDaemonConnection).mockClear();
    vi.mocked(qrScanner.scanCamera).mockReset();
    vi.mocked(qrScanner.scanImage).mockReset();
    useConnectionStore.setState({ connection: null, status: 'offline', activeConnectionId: null });
    window.localStorage.clear();
  });

  async function scanImageWith(result: QrScanResult) {
    vi.mocked(qrScanner.scanImage).mockResolvedValue(result);
    renderConnect();
    fireEvent.click(screen.getByTestId('connect-scan-image'));
  }

  it('exposes the image import under the accessible name "Scan from image"', () => {
    renderConnect();
    expect(screen.getByRole('button', { name: 'Scan from image' })).toBe(
      screen.getByTestId('connect-scan-image'),
    );
  });

  it('fills the URL from an image, leaves the key empty and submit disabled', async () => {
    await scanImageWith({
      status: 'ok',
      text: 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101',
    });
    await waitFor(() =>
      expect(screen.getByTestId('connect-url-input')).toHaveValue('ws://10.0.2.2:3101'),
    );
    expect(screen.getByTestId('connect-key-input')).toHaveValue('');
    expect(screen.getByTestId('connect-submit')).toBeDisabled();
    expect(screen.queryByTestId('connect-pairing-error')).not.toBeInTheDocument();
  });

  it('stores bridge info in secure storage and never renders it', async () => {
    await scanImageWith({
      status: 'ok',
      text: 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101&bridge=https%3A%2F%2Fbridge.example.invalid&bridgeSecret=bridge-secret-probe',
    });
    await waitFor(() =>
      expect(screen.getByTestId('connect-url-input')).toHaveValue('ws://10.0.2.2:3101'),
    );
    expect(document.body.outerHTML).not.toContain('bridge-secret-probe');
    await waitFor(async () =>
      expect(await getSecureStore().getSecret('pairing.pendingBridge')).toContain(
        'bridge-secret-probe',
      ),
    );
    expect(window.localStorage.length).toBe(0);
  });

  it.each([
    { status: 'none' } as const,
    { status: 'ok', text: 'hello' } as const,
    { status: 'ok', text: 'https://example.com' } as const,
    { status: 'ok', text: 'droidmobile://pair?v=2&url=wss://x.example.invalid' } as const,
  ])('rejects an image result %j and leaves the fields unchanged', async (result) => {
    vi.mocked(qrScanner.scanImage).mockResolvedValue(result);
    renderConnect();
    fireEvent.change(screen.getByTestId('connect-url-input'), { target: { value: 'ws://keep:1' } });
    fireEvent.click(screen.getByTestId('connect-scan-image'));
    expect(await screen.findByTestId('connect-pairing-error')).toHaveTextContent(
      /not a valid pairing code/i,
    );
    expect(screen.getByTestId('connect-url-input')).toHaveValue('ws://keep:1');
    expect(screen.getByTestId('connect-key-input')).toHaveValue('');
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });

  it('shows a permission message when the camera is denied and keeps manual entry usable', async () => {
    vi.mocked(qrScanner.scanCamera).mockResolvedValue({ status: 'denied' });
    renderConnect();
    fireEvent.click(screen.getByTestId('connect-scan-qr'));
    expect(await screen.findByTestId('connect-scan-notice')).toHaveTextContent(
      /camera permission is required/i,
    );
    expect(screen.getByTestId('connect-url-input')).toBeEnabled();
    expect(screen.getByTestId('connect-key-input')).toBeEnabled();
  });

  it('fills the fields from a live camera scan', async () => {
    vi.mocked(qrScanner.scanCamera).mockResolvedValue({
      status: 'ok',
      text: `droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101&key=${PROBE_KEY}`,
    });
    renderConnect();
    fireEvent.click(screen.getByTestId('connect-scan-qr'));
    await waitFor(() => expect(screen.getByTestId('connect-key-input')).toHaveValue(PROBE_KEY));
    expect(screen.getByTestId('connect-submit')).toBeEnabled();
  });

  it('does nothing visible when the user cancels', async () => {
    vi.mocked(qrScanner.scanCamera).mockResolvedValue({ status: 'cancelled' });
    renderConnect();
    fireEvent.click(screen.getByTestId('connect-scan-qr'));
    await waitFor(() => expect(qrScanner.scanCamera).toHaveBeenCalled());
    expect(screen.queryByTestId('connect-scan-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connect-pairing-error')).not.toBeInTheDocument();
  });

  it('clears a rejected secret-bearing payload from the field and the DOM', () => {
    renderConnect();
    const secret = 'S3CRET-bridge-value';
    const rejected = `droidmobile://pair?v=1&url=ftp%3A%2F%2Fx&key=${PROBE_KEY}&bridge=https%3A%2F%2Fb.example&bridgeSecret=${secret}`;
    fireEvent.change(screen.getByTestId('connect-paste-pairing'), { target: { value: rejected } });
    expect(screen.getByTestId('connect-pairing-error')).toBeInTheDocument();
    expect(screen.getByTestId('connect-paste-pairing')).toHaveValue('');
    const html = document.body.innerHTML;
    expect(html).not.toContain(PROBE_KEY);
    expect(html).not.toContain(secret);
  });

  it('shows the malformed-URL error for a fragment URL without constructing a socket', () => {
    renderConnect();
    fireEvent.change(screen.getByTestId('connect-url-input'), {
      target: { value: 'ws://127.0.0.1:3101#' },
    });
    fireEvent.change(screen.getByTestId('connect-key-input'), { target: { value: PROBE_KEY } });
    fireEvent.click(screen.getByTestId('connect-submit'));
    expect(screen.getByTestId('connect-error')).toBeInTheDocument();
    expect(createDaemonConnection).not.toHaveBeenCalled();
  });
});
