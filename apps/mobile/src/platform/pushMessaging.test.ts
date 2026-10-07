import { describe, expect, it, vi } from 'vitest';
import { createPushMessaging } from './pushMessaging';

function fakePlugin() {
  let listener: ((data: { token: string }) => void) | null = null;
  const remove = vi.fn(() => Promise.resolve());
  return {
    plugin: {
      getToken: vi.fn(() => Promise.resolve({ token: 'abc:def' })),
      addListener: vi.fn((_event: 'tokenReceived', next: (data: { token: string }) => void) => {
        listener = next;
        return Promise.resolve({ remove });
      }),
    },
    emit: (token: string) => listener?.({ token }),
    remove,
    // The app's own native plugin: settles only when Firebase's deletion Task does.
    native: { deleteToken: vi.fn(() => Promise.resolve()) },
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
    const { plugin, native } = fakePlugin();
    const api = createPushMessaging(plugin, () => true, native);
    expect(await api.deleteToken()).toBe(true);
    native.deleteToken.mockRejectedValueOnce(new Error('SERVICE_NOT_AVAILABLE'));
    expect(await api.deleteToken()).toBe(false);
    const web = createPushMessaging(plugin, () => false, native);
    expect(await web.deleteToken()).toBe(false);
    expect(native.deleteToken).toHaveBeenCalledTimes(2);
  });

  it('settles only after the native deletion finished and reports its late failure', async () => {
    const { plugin, native } = fakePlugin();
    let fail: (error: Error) => void = () => undefined;
    native.deleteToken.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    );
    const api = createPushMessaging(plugin, () => true, native);
    let settled: boolean | null = null;
    void api.deleteToken().then((result) => (settled = result));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBeNull();
    fail(new Error('SERVICE_NOT_AVAILABLE'));
    await vi.waitFor(() => expect(settled).toBe(false));
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
