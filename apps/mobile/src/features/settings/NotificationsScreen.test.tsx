import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../i18n/init';
import en from '../../i18n/en.json';
import ro from '../../i18n/ro.json';
import {
  NOTIFICATIONS_TURNS_KEY,
  useNotificationSettingsStore,
} from '../../stores/notificationSettings';
import { renderAppAt } from '../../test/render-app';

const native = vi.hoisted(() => ({
  supported: true,
  granted: false,
  grantOnRequest: true,
  request: vi.fn(),
  openSettings: vi.fn(async () => true),
}));

vi.mock('../../platform/appNotifications', () => ({
  appNotifications: {
    isSupported: () => native.supported,
    permissionGranted: vi.fn(async () => native.granted),
    requestPermission: native.request,
    openSettings: native.openSettings,
    configure: vi.fn(async () => undefined),
    post: vi.fn(async () => true),
    cancel: vi.fn(async () => undefined),
    onTap: vi.fn(() => () => undefined),
    onApprove: vi.fn(() => () => undefined),
  },
}));

describe('Settings > Notifications', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    useNotificationSettingsStore.setState({ enabled: true, approvals: true, turns: true });
    native.supported = true;
    native.granted = false;
    native.grantOnRequest = true;
    native.request.mockReset();
    native.request.mockImplementation(async () => {
      native.granted = native.grantOnRequest;
      return native.grantOnRequest;
    });
    native.openSettings.mockClear();
    await act(async () => {
      await changeAppLanguage('en');
    });
  });

  it('shows the permission state, the toggles and keeps stay connected and battery guidance', async () => {
    renderAppAt('/settings/notifications');
    const state = screen.getByTestId('settings-notifications-permission');
    await waitFor(() => expect(state).toHaveAttribute('data-state', 'denied'));
    expect(state).toHaveTextContent(en.notifications.permission.denied);
    expect(screen.getByTestId('settings-notifications-toggle')).not.toBeChecked();
    expect(screen.getByTestId('settings-channel-approvals-toggle')).toBeChecked();
    expect(screen.getByTestId('settings-channel-turns-toggle')).toBeChecked();
    expect(screen.getByTestId('settings-stay-connected-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('settings-battery-guidance')).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-unavailable')).not.toBeInTheDocument();
  });

  it('asks with a rationale first, then the system dialog, and turns on after Allow', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/notifications');
    await user.click(screen.getByTestId('settings-notifications-toggle'));
    expect(screen.getByTestId('notifications-rationale')).toHaveTextContent(
      en.notifications.rationale.message,
    );
    expect(native.request).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('notifications-rationale-confirm'));
    await waitFor(() => expect(screen.getByTestId('settings-notifications-toggle')).toBeChecked());
    expect(native.request).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('notifications-denied')).not.toBeInTheDocument();
  });

  it('does not show the system dialog when the rationale is cancelled', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/notifications');
    await user.click(screen.getByTestId('settings-notifications-toggle'));
    await user.click(screen.getByTestId('notifications-rationale-cancel'));
    expect(native.request).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-notifications-toggle')).not.toBeChecked();
  });

  it('leaves the toggle off after a refusal, explains it and opens the system settings', async () => {
    native.grantOnRequest = false;
    const user = userEvent.setup();
    renderAppAt('/settings/notifications');
    await user.click(screen.getByTestId('settings-notifications-toggle'));
    await user.click(screen.getByTestId('notifications-rationale-confirm'));
    await waitFor(() => expect(native.request).toHaveBeenCalled());
    expect(screen.getByTestId('settings-notifications-toggle')).not.toBeChecked();
    expect(screen.getByTestId('notifications-denied')).toHaveTextContent(en.notifications.denied);
    await user.click(screen.getByTestId('notifications-open-settings'));
    expect(native.openSettings).toHaveBeenCalledTimes(1);

    native.granted = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.getByTestId('settings-notifications-toggle')).toBeChecked());
    expect(screen.queryByTestId('notifications-denied')).not.toBeInTheDocument();
  });

  it('turns on without any dialog when Android already allows notifications', async () => {
    native.granted = true;
    useNotificationSettingsStore.setState({ enabled: false });
    const user = userEvent.setup();
    renderAppAt('/settings/notifications');
    const toggle = screen.getByTestId('settings-notifications-toggle');
    await waitFor(() =>
      expect(screen.getByTestId('settings-notifications-permission')).toHaveAttribute(
        'data-state',
        'granted',
      ),
    );
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(native.request).not.toHaveBeenCalled();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(useNotificationSettingsStore.getState().enabled).toBe(false);
  });

  it('persists the per-channel toggles', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/notifications');
    await user.click(screen.getByTestId('settings-channel-turns-toggle'));
    expect(screen.getByTestId('settings-channel-turns-toggle')).not.toBeChecked();
    expect(screen.getByTestId('settings-channel-approvals-toggle')).toBeChecked();
    expect(window.localStorage.getItem(NOTIFICATIONS_TURNS_KEY)).toBe('false');
  });

  it('disables the switches and says so outside the Android app', () => {
    native.supported = false;
    renderAppAt('/settings/notifications');
    expect(screen.getByTestId('settings-notifications-toggle')).toBeDisabled();
    expect(screen.getByTestId('settings-notifications-unsupported')).toHaveTextContent(
      en.notifications.notAvailable,
    );
  });

  it('follows the app language', async () => {
    renderAppAt('/settings/notifications');
    await act(async () => {
      await changeAppLanguage('ro');
    });
    expect(screen.getByLabelText(ro.notifications.channel.approvals)).toBeInTheDocument();
    expect(screen.getByLabelText(ro.notifications.channel.turns)).toBeInTheDocument();
    expect(screen.getByLabelText(ro.notifications.master)).toBeInTheDocument();
  });
});
