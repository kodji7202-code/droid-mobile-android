import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../i18n/init';
import en from '../../i18n/en.json';
import ro from '../../i18n/ro.json';
import { useStayConnectedStore } from '../../stores/stayConnected';
import { renderAppAt } from '../../test/render-app';

const native = vi.hoisted(() => ({
  state: 'notExempt' as 'exempt' | 'notExempt' | 'unknown',
  open: vi.fn(async () => true),
}));

vi.mock('../../platform/daemonService', () => ({
  daemonService: {
    isSupported: () => true,
    start: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
    consumeStopRequest: vi.fn(async () => false),
    batteryState: vi.fn(async () => native.state),
    openBatterySettings: native.open,
    onEnded: vi.fn(() => () => undefined),
  },
}));

describe('Settings > Notifications > stay connected and battery guidance', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    useStayConnectedStore.setState({ enabled: false });
    native.state = 'notExempt';
    native.open.mockClear();
    await act(async () => {
      await changeAppLanguage('en');
    });
  });

  it('toggles stay connected and persists it', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/notifications');
    const toggle = screen.getByTestId('settings-stay-connected-toggle');
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(useStayConnectedStore.getState().enabled).toBe(true);
    expect(window.localStorage.getItem('droid.stayConnected')).toBe('true');
  });

  it('opens the guidance with the bundle texts in en and ro, and back returns to Notifications', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/notifications');
    await user.click(screen.getByTestId('settings-battery-guidance'));
    expect(await screen.findByTestId('battery-guidance-screen')).toBeInTheDocument();
    expect(screen.getByTestId('battery-guidance-why')).toHaveTextContent(en.battery.why);
    expect(screen.getByTestId('battery-guidance-steps')).toHaveTextContent(en.battery.step3);
    await act(async () => {
      await changeAppLanguage('ro');
    });
    expect(screen.getByTestId('battery-guidance-why')).toHaveTextContent(ro.battery.why);
    expect(screen.getByTestId('battery-guidance-open-settings')).toHaveTextContent(
      ro.battery.openSettings,
    );
    await user.click(screen.getByTestId('settings-back'));
    expect(screen.getByTestId('notifications-screen')).toBeInTheDocument();
  });

  it('shows the real exemption state and opens the system settings', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/notifications/battery');
    const state = screen.getByTestId('battery-guidance-state');
    await waitFor(() => expect(state).toHaveAttribute('data-state', 'notExempt'));
    expect(state).toHaveTextContent(en.battery.state.notExempt);

    native.state = 'exempt';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(state).toHaveAttribute('data-state', 'exempt'));
    expect(state).toHaveTextContent(en.battery.state.exempt);

    await user.click(screen.getByTestId('battery-guidance-open-settings'));
    expect(native.open).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('battery-guidance-error')).not.toBeInTheDocument();
  });

  it('reports a settings screen that could not be opened', async () => {
    const user = userEvent.setup();
    native.open.mockResolvedValueOnce(false);
    renderAppAt('/settings/notifications/battery');
    await user.click(screen.getByTestId('battery-guidance-open-settings'));
    expect(await screen.findByTestId('battery-guidance-error')).toHaveTextContent(
      en.battery.openFailed,
    );
  });
});
