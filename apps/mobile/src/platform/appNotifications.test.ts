import { describe, expect, it, vi } from 'vitest';
import { createAppNotifications } from './appNotifications';

function fakePlugin() {
  const listeners = new Map<string, (data: never) => void>();
  return {
    listeners,
    plugin: {
      checkPermission: vi.fn(async () => ({ granted: true })),
      requestPermission: vi.fn(async () => ({ granted: false })),
      openSettings: vi.fn(async () => undefined),
      configure: vi.fn(async () => undefined),
      post: vi.fn(async () => ({ posted: true })),
      cancel: vi.fn(async () => undefined),
      addListener: vi.fn(async (event: string, listener: (data: never) => void) => {
        listeners.set(event, listener);
        return { remove: vi.fn(async () => undefined) };
      }),
    },
  };
}

describe('appNotifications', () => {
  it('does nothing outside the Android app', async () => {
    const { plugin } = fakePlugin();
    const api = createAppNotifications(plugin as never, () => false);
    expect(api.isSupported()).toBe(false);
    expect(await api.permissionGranted()).toBe(false);
    expect(await api.requestPermission()).toBe(false);
    expect(await api.openSettings()).toBe(false);
    expect(
      await api.post({ tag: 't', channel: 'turns', title: '', text: '', sessionId: 's' }),
    ).toBe(false);
    await api.configure({
      channelNames: { approvals: 'a', turns: 't', service: 's' },
      enabled: true,
      approvals: true,
      turns: true,
    });
    await api.cancel('t');
    expect(plugin.checkPermission).not.toHaveBeenCalled();
    expect(plugin.post).not.toHaveBeenCalled();
    expect(plugin.configure).not.toHaveBeenCalled();
  });

  it('forwards calls to the plugin and reports its answers', async () => {
    const { plugin } = fakePlugin();
    const api = createAppNotifications(plugin as never, () => true);
    expect(await api.permissionGranted()).toBe(true);
    expect(await api.requestPermission()).toBe(false);
    expect(await api.openSettings()).toBe(true);
    const notification = {
      tag: 'turn:s',
      channel: 'turns' as const,
      title: 'T',
      text: 'x',
      sessionId: 's',
    };
    expect(await api.post(notification)).toBe(true);
    expect(plugin.post).toHaveBeenCalledWith(notification);
    await api.cancel('turn:s');
    expect(plugin.cancel).toHaveBeenCalledWith({ tag: 'turn:s' });
  });

  it('treats plugin failures as a refusal instead of throwing', async () => {
    const { plugin } = fakePlugin();
    plugin.checkPermission.mockRejectedValue(new Error('boom'));
    plugin.post.mockRejectedValue(new Error('boom'));
    plugin.openSettings.mockRejectedValue(new Error('none'));
    const api = createAppNotifications(plugin as never, () => true);
    expect(await api.permissionGranted()).toBe(false);
    expect(
      await api.post({ tag: 't', channel: 'turns', title: '', text: '', sessionId: 's' }),
    ).toBe(false);
    expect(await api.openSettings()).toBe(false);
  });

  it('delivers taps and approvals to listeners', () => {
    const { plugin, listeners } = fakePlugin();
    const api = createAppNotifications(plugin as never, () => true);
    const tap = vi.fn();
    const approve = vi.fn();
    api.onTap(tap);
    api.onApprove(approve);
    listeners.get('notificationTapped')?.({ sessionId: 's1' } as never);
    listeners.get('notificationApproved')?.({ requestId: 'r1', sessionId: 's1' } as never);
    expect(tap).toHaveBeenCalledWith('s1');
    expect(approve).toHaveBeenCalledWith('r1', 's1');
  });
});
