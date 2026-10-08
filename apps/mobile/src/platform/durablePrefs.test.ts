import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isNative: false,
  failSet: false,
  store: new Map<string, string>(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.isNative },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: ({ key }: { key: string }) => Promise.resolve({ value: native.store.get(key) ?? null }),
    set: ({ key, value }: { key: string; value: string }) => {
      if (native.failSet) return Promise.reject(new Error('plugin down'));
      native.store.set(key, value);
      return Promise.resolve();
    },
  },
}));

// The test setup already imported the real module graph, so load a fresh copy that sees the mocks.
async function load() {
  vi.resetModules();
  return import('./durablePrefs');
}

describe('durablePrefs', () => {
  beforeEach(() => {
    native.isNative = true;
    native.failSet = false;
    native.store.clear();
    window.localStorage.clear();
  });

  it('lists exactly the keys the stores and providers persist', async () => {
    const { DURABLE_PREF_KEYS } = await load();
    const { STAY_CONNECTED_KEY } = await import('../stores/stayConnected');
    const notifications = await import('../stores/notificationSettings');
    const { LOCK_ENABLED_KEY, LOCK_GRACE_KEY } = await import('../stores/lock');
    const { LANGUAGE_STORAGE_KEY } = await import('../i18n/init');
    expect([...DURABLE_PREF_KEYS].sort()).toEqual(
      [
        STAY_CONNECTED_KEY,
        LANGUAGE_STORAGE_KEY,
        'droidm.theme',
        notifications.NOTIFICATIONS_ENABLED_KEY,
        notifications.NOTIFICATIONS_APPROVALS_KEY,
        notifications.NOTIFICATIONS_TURNS_KEY,
        LOCK_ENABLED_KEY,
        LOCK_GRACE_KEY,
      ].sort(),
    );
  });

  it('lets the native value win over a stale localStorage value', async () => {
    window.localStorage.setItem('droidm.theme', 'light');
    native.store.set('droidm.theme', 'dark');
    await (await load()).restoreDurablePrefs();
    expect(window.localStorage.getItem('droidm.theme')).toBe('dark');
    expect(native.store.get('droidm.theme')).toBe('dark');
  });

  it('restores a native value that localStorage lost', async () => {
    native.store.set('droid.notifications.turns', 'false');
    await (await load()).restoreDurablePrefs();
    expect(window.localStorage.getItem('droid.notifications.turns')).toBe('false');
  });

  it('migrates an existing install by copying localStorage up to native', async () => {
    window.localStorage.setItem('droidm.lang', 'ro');
    window.localStorage.setItem('droid.stayConnected', 'true');
    await (await load()).restoreDurablePrefs();
    expect(native.store.get('droidm.lang')).toBe('ro');
    expect(native.store.get('droid.stayConnected')).toBe('true');
    expect(window.localStorage.getItem('droidm.lang')).toBe('ro');
  });

  it('leaves keys that exist nowhere unset', async () => {
    await (await load()).restoreDurablePrefs();
    expect(native.store.size).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });

  it('ignores keys outside the fixed list', async () => {
    native.store.set('droid.apiKey', 'secret');
    window.localStorage.setItem('droid.savedConnections', '[]');
    await (await load()).restoreDurablePrefs();
    expect(window.localStorage.getItem('droid.apiKey')).toBeNull();
    expect(native.store.has('droid.savedConnections')).toBe(false);
  });

  it('is a no-op on the web', async () => {
    native.isNative = false;
    native.store.set('droidm.theme', 'dark');
    window.localStorage.setItem('droidm.lang', 'ro');
    await (await load()).restoreDurablePrefs();
    expect(window.localStorage.getItem('droidm.theme')).toBeNull();
    expect(native.store.has('droidm.lang')).toBe(false);
  });

  it('writePref writes localStorage and the native mirror', async () => {
    await (await load()).writePref('droidm.theme', 'dark');
    expect(window.localStorage.getItem('droidm.theme')).toBe('dark');
    expect(native.store.get('droidm.theme')).toBe('dark');
  });

  it('writePref only touches localStorage on the web', async () => {
    native.isNative = false;
    await (await load()).writePref('droidm.theme', 'dark');
    expect(window.localStorage.getItem('droidm.theme')).toBe('dark');
    expect(native.store.size).toBe(0);
  });

  it('writePref survives a failing native plugin', async () => {
    native.failSet = true;
    await expect((await load()).writePref('droidm.lang', 'ro')).resolves.toBeUndefined();
    expect(window.localStorage.getItem('droidm.lang')).toBe('ro');
  });
});
