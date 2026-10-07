import { describe, expect, it, vi } from 'vitest';
import { createPushMessaging } from './pushMessaging';

function fakePlugin() {
  let listener: ((data: { token: string }) => void) | null = null;
  const remove = vi.fn(() => Promise.resolve());
  return {
    plugin: {
      getToken: vi.fn(() => Promise.resolve({ token: 'abc:def' })),
      deleteToken: vi.fn(() => Promise.resolve()),
      addListener: vi.fn((_event: 'tokenReceived', next: (data: { token: string }) => void) => {
        listener = next;
        return Promise.resolve({ remove });
      }),
    },
    emit: (token: string) => listener?.({ token }),
    remove,
  };
}

describe('push messaging wrapper', () => {
  it('returns the plugin token on native and null on failure or empty values', async () => {
    const { plugin } = fakePlugin();
    const api = createPushMessaging(plugin, () => true);
    expect(api.isSupported()).toBe(true);
    expect(await api.getToken()).toBe('abc:def');
    plugin.getToken.mockResolvedValueOnce({ token: '' });
    expect(await api.getToken()).toBeNull();
    plugin.getToken.mockRejectedValueOnce(new Error('SERVICE_NOT_AVAILABLE'));
    expect(await api.getToken()).toBeNull();
  });

  it('does nothing off the Android app', async () => {
    const { plugin } = fakePlugin();
    const api = createPushMessaging(plugin, () => false);
    expect(api.isSupported()).toBe(false);
    expect(await api.getToken()).toBeNull();
    api.onTokenRefresh(() => undefined)();
    expect(plugin.getToken).not.toHaveBeenCalled();
    expect(plugin.addListener).not.toHaveBeenCalled();
  });

  it('reports whether the token could be invalidated', async () => {
    const { plugin } = fakePlugin();
    const api = createPushMessaging(plugin, () => true);
    expect(await api.deleteToken()).toBe(true);
    plugin.deleteToken.mockRejectedValueOnce(new Error('SERVICE_NOT_AVAILABLE'));
    expect(await api.deleteToken()).toBe(false);
    const web = createPushMessaging(plugin, () => false);
    expect(await web.deleteToken()).toBe(false);
    expect(plugin.deleteToken).toHaveBeenCalledTimes(2);
  });

  it('forwards token refreshes and removes the listener on dispose', async () => {
    const { plugin, emit, remove } = fakePlugin();
    const api = createPushMessaging(plugin, () => true);
    const seen: string[] = [];
    const stop = api.onTokenRefresh((token) => seen.push(token));
    emit('new:token');
    emit('');
    expect(seen).toEqual(['new:token']);
    stop();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
