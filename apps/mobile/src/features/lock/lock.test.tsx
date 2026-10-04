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

  it('disables the toggle with the reason when nothing is enrolled', async () => {
    isAvailable.mockResolvedValue(false);
    renderSecurity();
    expect(await screen.findByTestId('settings-biometric-unavailable')).toHaveTextContent(
      'screen lock or biometric',
    );
    const toggle = screen.getByTestId('settings-biometric-toggle');
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(authenticate).not.toHaveBeenCalled();
    expect(toggle).not.toBeChecked();
  });

  it('refuses without any enrolled credential and never prompts when enrolment vanishes', async () => {
    isAvailable.mockResolvedValueOnce(true).mockResolvedValue(false);
    renderSecurity();
    await waitFor(() => expect(isAvailable).toHaveBeenCalled());
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

  it('does not open the add form or switch when the prompt is cancelled', async () => {
    const switchTo = vi.fn().mockResolvedValue(undefined);
    useConnectionStore.setState({
      savedConnections: [FIRST, { id: 'b', label: 'Second', url: 'wss://example.test' }],
      savedActiveId: 'a',
      status: 'ready',
      switchTo,
    });
    authenticate.mockResolvedValue('cancelled');
    renderAppAt('/settings/connection', { connection: {} as DaemonConnection });

    fireEvent.click(screen.getByTestId('connection-add'));
    expect(await screen.findByTestId('connection-reveal-error')).toBeInTheDocument();
    expect(screen.queryByTestId('connection-form')).toBeNull();

    fireEvent.click(screen.getByTestId('connection-switch-b'));
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(2));
    expect(switchTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('connection-active-marker-a')).toBeInTheDocument();
  });

  it('opens the add form and switches only after a successful prompt', async () => {
    const switchTo = vi.fn().mockResolvedValue(undefined);
    useConnectionStore.setState({
      savedConnections: [FIRST, { id: 'b', label: 'Second', url: 'wss://example.test' }],
      savedActiveId: 'a',
      status: 'ready',
      switchTo,
    });
    authenticate.mockResolvedValue('success');
    renderAppAt('/settings/connection', { connection: {} as DaemonConnection });

    fireEvent.click(screen.getByTestId('connection-add'));
    expect(await screen.findByTestId('connection-form')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('connection-switch-b'));
    await waitFor(() => expect(switchTo).toHaveBeenCalledWith('b'));
  });

  it('shows URLs directly when the lock is off', () => {
    useLockStore.setState({ enabled: false });
    renderConnection();
    expect(screen.getByTestId('connection-active-url')).toHaveTextContent(FIRST.url);
  });
});
