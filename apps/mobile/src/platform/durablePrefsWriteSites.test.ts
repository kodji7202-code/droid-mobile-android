import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writePref = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('./durablePrefs', () => ({ writePref }));

// The test setup already imported the real module graph, so load fresh copies that see the mock.
async function fresh<T>(load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  return load();
}

describe('settings write through the durable mirror', () => {
  beforeEach(() => {
    writePref.mockClear();
  });

  it('stay connected', async () => {
    const { useStayConnectedStore } = await fresh(() => import('../stores/stayConnected'));
    useStayConnectedStore.getState().setEnabled(true);
    expect(writePref).toHaveBeenCalledWith('droid.stayConnected', 'true');
  });

  it('notification master and channel switches', async () => {
    const { useNotificationSettingsStore } = await fresh(
      () => import('../stores/notificationSettings'),
    );
    useNotificationSettingsStore.getState().setEnabled(false);
    useNotificationSettingsStore.getState().setChannel('turns', false);
    useNotificationSettingsStore.getState().setChannel('approvals', false);
    expect(writePref).toHaveBeenCalledWith('droid.notifications.enabled', 'false');
    expect(writePref).toHaveBeenCalledWith('droid.notifications.turns', 'false');
    expect(writePref).toHaveBeenCalledWith('droid.notifications.approvals', 'false');
  });

  it('app lock and grace period', async () => {
    const { useLockStore } = await fresh(() => import('../stores/lock'));
    useLockStore.getState().setEnabled(true);
    useLockStore.getState().setGraceSeconds(60);
    expect(writePref).toHaveBeenCalledWith('droid.lock.enabled', 'true');
    expect(writePref).toHaveBeenCalledWith('droid.lock.graceSeconds', '60');
  });

  it('language', async () => {
    const { changeAppLanguage } = await fresh(() => import('../i18n/init'));
    await changeAppLanguage('ro');
    expect(writePref).toHaveBeenCalledWith('droidm.lang', 'ro');
    await changeAppLanguage('en');
  });

  it('theme', async () => {
    const { ThemeProvider, useTheme } = await fresh(() => import('../theme/ThemeProvider'));
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    act(() => result.current.setPreference('dark'));
    expect(writePref).toHaveBeenCalledWith('droidm.theme', 'dark');
  });
});
