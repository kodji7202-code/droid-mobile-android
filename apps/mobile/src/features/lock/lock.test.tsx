import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { i18nReady } from '../../i18n/init';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useLockStore } from '../../stores/lock';
import { biometrics } from '../../platform/biometrics';
import { LockScreen } from './LockScreen';

vi.mock('../../platform/biometrics', () => ({
  biometrics: { isAvailable: vi.fn(), authenticate: vi.fn() },
}));

const authenticate = vi.mocked(biometrics.authenticate);
const isAvailable = vi.mocked(biometrics.isAvailable);
const FIRST = { id: 'a', label: 'First', url: 'ws://127.0.0.1:3101' };

beforeEach(async () => {
  await i18nReady;
  window.localStorage.clear();
  authenticate.mockReset();
  isAvailable.mockReset().mockResolvedValue(true);
  useLockStore.setState({ enabled: true, locked: false, graceSeconds: 30 });
});

afterEach(() => {
  act(() => {
    useLockStore.setState({ enabled: false, locked: false });
    useConnectionStore.setState({
      connection: null,
      status: 'offline',
      savedConnections: [],
      savedActiveId: null,
    });
  });
});

describe('LockScreen', () => {
  it('prompts at once, restores the connection only after success, then unlocks', async () => {
    const restore = vi.fn(() => Promise.resolve());
    useConnectionStore.setState({ restore, connection: null });
    useLockStore.setState({ locked: true });
    authenticate.mockResolvedValue('success');
    render(<LockScreen />);
    await waitFor(() => expect(useLockStore.getState().locked).toBe(false));
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
  ] as const)('stays locked after a %s prompt and offers a retry', async (outcome, problem) => {
    const restore = vi.fn(() => Promise.resolve());
    useConnectionStore.setState({ restore, connection: null });
    useLockStore.setState({ locked: true });
    authenticate.mockResolvedValue(outcome);
    render(<LockScreen />);
    const error = await screen.findByTestId('lock-error');
    expect(error).toHaveAttribute('data-problem', problem);
    expect(useLockStore.getState().locked).toBe(true);
    expect(restore).not.toHaveBeenCalled();

    authenticate.mockResolvedValue('success');
    fireEvent.click(screen.getByTestId('lock-unlock'));
    await waitFor(() => expect(useLockStore.getState().locked).toBe(false));
    expect(restore).toHaveBeenCalledTimes(1);
  });
});

describe('Settings > Security', () => {
  function renderSecurity() {
    return renderAppAt('/settings/security', { connection: {} as DaemonConnection });
  }

  beforeEach(() => useLockStore.setState({ enabled: false }));

  it('turns on only after a successful prompt', async () => {
    authenticate.mockResolvedValue('success');
    renderSecurity();
    fireEvent.click(screen.getByTestId('settings-biometric-toggle'));
    await waitFor(() => expect(useLockStore.getState().enabled).toBe(true));
    expect(screen.getByTestId('settings-biometric-toggle')).toBeChecked();
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
  ] as const)('stays off with a message when the prompt is %s', async (outcome, word) => {
    authenticate.mockResolvedValue(outcome);
    renderSecurity();
    fireEvent.click(screen.getByTestId('settings-biometric-toggle'));
    expect(await screen.findByTestId('settings-biometric-message')).toHaveTextContent(word);
    expect(screen.getByTestId('settings-biometric-toggle')).not.toBeChecked();
    expect(useLockStore.getState().enabled).toBe(false);
  });

  it('refuses without any enrolled credential and never prompts', async () => {
    isAvailable.mockResolvedValue(false);
    renderSecurity();
    fireEvent.click(screen.getByTestId('settings-biometric-toggle'));
    expect(await screen.findByTestId('settings-biometric-message')).toHaveTextContent(
      'screen lock or biometric',
    );
    expect(authenticate).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-biometric-toggle')).not.toBeChecked();
  });

  it('needs a prompt to turn the lock off and persists the grace period', async () => {
    useLockStore.setState({ enabled: true });
    authenticate.mockResolvedValue('cancelled');
    renderSecurity();
    fireEvent.click(screen.getByTestId('settings-biometric-toggle'));
    await screen.findByTestId('settings-biometric-message');
    expect(useLockStore.getState().enabled).toBe(true);

    fireEvent.change(screen.getByTestId('settings-biometric-grace'), { target: { value: '60' } });
    expect(useLockStore.getState().graceSeconds).toBe(60);
  });
});

describe('Settings > Connection gate', () => {
  function renderConnection() {
    useConnectionStore.setState({
      savedConnections: [FIRST],
      savedActiveId: 'a',
      status: 'ready',
    });
    return renderAppAt('/settings/connection', { connection: {} as DaemonConnection });
  }

  it('hides URLs and keeps them hidden when the prompt is cancelled', async () => {
    authenticate.mockResolvedValue('cancelled');
    renderConnection();
    expect(document.body.textContent).not.toContain(FIRST.url);
    fireEvent.click(screen.getByTestId('connection-edit-a'));
    expect(await screen.findByTestId('connection-reveal-error')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(FIRST.url);
    expect(screen.queryByTestId('connection-url-input')).toBeNull();
  });

  it('reveals the URL and opens the edit form after a successful prompt', async () => {
    authenticate.mockResolvedValue('success');
    renderConnection();
    fireEvent.click(screen.getByTestId('connection-edit-a'));
    await waitFor(() =>
      expect(screen.getByTestId('connection-active-url')).toHaveTextContent(FIRST.url),
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('shows URLs directly when the lock is off', () => {
    useLockStore.setState({ enabled: false });
    renderConnection();
    expect(screen.getByTestId('connection-active-url')).toHaveTextContent(FIRST.url);
  });
});
