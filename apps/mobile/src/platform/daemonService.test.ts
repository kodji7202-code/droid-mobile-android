import { describe, expect, it, vi } from 'vitest';
import { createDaemonService } from './daemonService';

const TEXTS = { title: 'Connected', text: 'Alive', stopLabel: 'Stop' };

function fakePlugin() {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    isRunning: vi.fn(async () => ({ running: true })),
    consumeStopRequest: vi.fn(async () => ({ requested: true })),
    getBatteryState: vi.fn(async () => ({ exempt: true })),
    openBatterySettings: vi.fn(async () => undefined),
    addListener: vi.fn(
      async (_event: 'serviceStopped' | 'serviceTimedOut', _listener: () => void) => ({
        remove: vi.fn(async () => undefined),
      }),
    ),
  };
}

describe('daemonService wrapper', () => {
  it('is inert on the web build', async () => {
    const plugin = fakePlugin();
    const service = createDaemonService(plugin, () => false);
    expect(service.isSupported()).toBe(false);
    expect(await service.start(TEXTS)).toBe(false);
    await service.stop();
    expect(await service.consumeStopRequest()).toBe(false);
    expect(await service.batteryState()).toBe('unknown');
    expect(await service.openBatterySettings()).toBe(false);
    expect(plugin.start).not.toHaveBeenCalled();
    expect(plugin.stop).not.toHaveBeenCalled();
    expect(plugin.addListener).not.toHaveBeenCalled();
  });

  it('forwards start, stop and the stop request to the native plugin', async () => {
    const plugin = fakePlugin();
    const service = createDaemonService(plugin, () => true);
    expect(await service.start(TEXTS)).toBe(true);
    expect(plugin.start).toHaveBeenCalledWith(TEXTS);
    await service.stop();
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(await service.consumeStopRequest()).toBe(true);
  });

  it('reports a refused start as false instead of throwing', async () => {
    const plugin = fakePlugin();
    plugin.start.mockRejectedValueOnce(new Error('START_FAILED'));
    expect(await createDaemonService(plugin, () => true).start(TEXTS)).toBe(false);
  });

  it('maps the battery exemption and a failed settings launch', async () => {
    const plugin = fakePlugin();
    const service = createDaemonService(plugin, () => true);
    expect(await service.batteryState()).toBe('exempt');
    plugin.getBatteryState.mockResolvedValueOnce({ exempt: false });
    expect(await service.batteryState()).toBe('notExempt');
    plugin.getBatteryState.mockRejectedValueOnce(new Error('boom'));
    expect(await service.batteryState()).toBe('unknown');
    plugin.openBatterySettings.mockRejectedValueOnce(new Error('NO_SETTINGS'));
    expect(await service.openBatterySettings()).toBe(false);
  });

  it('subscribes to both end events and unsubscribes on cleanup', async () => {
    const plugin = fakePlugin();
    const remove = vi.fn(async () => undefined);
    plugin.addListener.mockResolvedValue({ remove });
    const listener = vi.fn();
    const off = createDaemonService(plugin, () => true).onEnded(listener);
    expect(plugin.addListener.mock.calls.map((call) => call[0])).toEqual([
      'serviceStopped',
      'serviceTimedOut',
    ]);
    off();
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
