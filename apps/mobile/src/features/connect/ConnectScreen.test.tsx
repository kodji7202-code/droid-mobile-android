import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';

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

describe('ConnectScreen (shell placeholder until the onboarding feature)', () => {
  beforeEach(() => {
    connectMock.mockReset();
    connectMock.mockResolvedValue(undefined);
    disconnectMock.mockReset();
    onStatusMock.mockClear();
    useConnectionStore.setState({ connection: null, status: 'offline' });
    window.localStorage.clear();
  });

  it('disables submit until both the URL and the key are non-empty', async () => {
    const user = userEvent.setup();
    renderAppAt('/connect');
    const submit = screen.getByTestId('connect-submit');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('connect-url-input'), 'ws://127.0.0.1:3101');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('connect-key-input'), 'fk-test-key-value');
    expect(submit).toBeEnabled();
  });

  it('connects through the daemon-client store and lands on Sessions', async () => {
    const user = userEvent.setup();
    renderAppAt('/connect');
    await user.type(screen.getByTestId('connect-url-input'), 'ws://127.0.0.1:3101');
    await user.type(screen.getByTestId('connect-key-input'), 'fk-test-key-value');
    await user.click(screen.getByTestId('connect-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('sessions-screen')).toBeInTheDocument();
    });
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('shows a localized inline error when connecting fails and saves nothing', async () => {
    connectMock.mockRejectedValue(new Error('connect failed'));
    const user = userEvent.setup();
    renderAppAt('/connect');
    await user.type(screen.getByTestId('connect-url-input'), 'ws://127.0.0.1:3101');
    await user.type(screen.getByTestId('connect-key-input'), 'fk-test-key-value');
    await user.click(screen.getByTestId('connect-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('connect-error')).toBeInTheDocument();
    });
    expect(useConnectionStore.getState().connection).toBeNull();
    expect(screen.queryByTestId('sessions-screen')).not.toBeInTheDocument();
  });
});
