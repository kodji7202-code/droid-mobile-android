import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonServiceApi, ServiceTexts } from './daemonService';
import { ServiceSync, STOP_DELAY_MS, serviceWanted } from './serviceSync';

const TEXTS = { title: 'Connected', text: 'Alive', stopLabel: 'Stop' };
const IDLE = { stayConnected: false, turnActive: false, requestPending: false };

function fakeService() {
  const service = {
    isSupported: () => true,
    start: vi.fn(async (_texts: ServiceTexts) => true),
    stop: vi.fn(async () => undefined),
    consumeStopRequest: vi.fn(async () => false),
    batteryState: vi.fn(async () => 'unknown' as const),
    openBatterySettings: vi.fn(async () => true),
    onEnded: vi.fn(() => () => undefined),
  } satisfies DaemonServiceApi;
  return service;
}

describe('serviceWanted', () => {
  it('is wanted for a turn, a pending request or stay connected, and not when idle', () => {
    expect(serviceWanted(IDLE)).toBe(false);
    expect(serviceWanted({ ...IDLE, turnActive: true })).toBe(true);
    expect(serviceWanted({ ...IDLE, requestPending: true })).toBe(true);
    expect(serviceWanted({ ...IDLE, stayConnected: true })).toBe(true);
  });
});

describe('ServiceSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does nothing while idle', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    sync.update(IDLE, TEXTS);
    vi.advanceTimersByTime(STOP_DELAY_MS * 2);
    expect(service.start).not.toHaveBeenCalled();
    expect(service.stop).not.toHaveBeenCalled();
  });

  it('starts at once when a turn begins and stops 3 s after it ends', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    sync.update({ ...IDLE, turnActive: true }, TEXTS);
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(service.start).toHaveBeenCalledWith(TEXTS);
    sync.update(IDLE, TEXTS);
    vi.advanceTimersByTime(STOP_DELAY_MS - 1);
    expect(service.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the service when a new turn starts inside the grace period', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    sync.update({ ...IDLE, turnActive: true }, TEXTS);
    sync.update(IDLE, TEXTS);
    vi.advanceTimersByTime(STOP_DELAY_MS - 1000);
    sync.update({ ...IDLE, turnActive: true }, TEXTS);
    vi.advanceTimersByTime(STOP_DELAY_MS * 2);
    expect(service.stop).not.toHaveBeenCalled();
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('counts a pending request as running', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    sync.update({ ...IDLE, requestPending: true }, TEXTS);
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('does not stop while stay connected stays on after the turn ends', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    sync.update({ stayConnected: true, turnActive: true, requestPending: false }, TEXTS);
    sync.update({ stayConnected: true, turnActive: false, requestPending: false }, TEXTS);
    vi.advanceTimersByTime(STOP_DELAY_MS * 2);
    expect(service.stop).not.toHaveBeenCalled();
  });

  it('does not restart a service the user stopped until the demand ended and returned', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    const turn = { ...IDLE, turnActive: true };
    sync.update(turn, TEXTS);
    sync.ended();
    sync.update({ ...turn, requestPending: true }, TEXTS);
    expect(service.start).toHaveBeenCalledTimes(1);
    sync.update(IDLE, TEXTS);
    vi.advanceTimersByTime(STOP_DELAY_MS * 2);
    expect(service.stop).not.toHaveBeenCalled();
    sync.update(turn, TEXTS);
    expect(service.start).toHaveBeenCalledTimes(2);
  });

  it('restarts after an Android timeout once the app is back in the foreground', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    const stay = { ...IDLE, stayConnected: true };
    sync.update(stay, TEXTS);
    sync.timedOut(false);
    sync.update({ ...stay, turnActive: true }, TEXTS);
    expect(service.start).toHaveBeenCalledTimes(1);
    sync.resumed();
    expect(service.start).toHaveBeenCalledTimes(2);
    expect(service.start).toHaveBeenLastCalledWith(TEXTS);
    sync.resumed();
    expect(service.start).toHaveBeenCalledTimes(2);
  });

  it('restarts at once when the timeout happens while the app is in the foreground', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    sync.update({ ...IDLE, stayConnected: true }, TEXTS);
    sync.timedOut(true);
    expect(service.start).toHaveBeenCalledTimes(2);
  });

  it('does not restart after a timeout when nothing wants the service any more', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    sync.update({ ...IDLE, turnActive: true }, TEXTS);
    sync.timedOut(false);
    sync.update(IDLE, TEXTS);
    sync.resumed();
    vi.advanceTimersByTime(STOP_DELAY_MS * 2);
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(service.stop).not.toHaveBeenCalled();
  });

  it('keeps a Stop press final even when a timeout wait is pending', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    const stay = { ...IDLE, stayConnected: true };
    sync.update(stay, TEXTS);
    sync.ended();
    sync.timedOut(true);
    sync.resumed();
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('refreshes the notification texts of a running service when the language changes', () => {
    const service = fakeService();
    const sync = new ServiceSync(service);
    sync.update({ ...IDLE, stayConnected: true }, TEXTS);
    const romanian = { title: 'Conectat', text: 'Activ', stopLabel: 'Opre?te' };
    sync.update({ ...IDLE, stayConnected: true }, romanian);
    expect(service.start).toHaveBeenCalledTimes(2);
    expect(service.start).toHaveBeenLastCalledWith(romanian);
  });

  it('retries a start that Android refused on the next update', async () => {
    const service = fakeService();
    service.start.mockResolvedValueOnce(false);
    const sync = new ServiceSync(service);
    const turn = { ...IDLE, turnActive: true };
    sync.update(turn, TEXTS);
    await vi.advanceTimersByTimeAsync(0);
    sync.update({ ...turn, requestPending: true }, TEXTS);
    expect(service.start).toHaveBeenCalledTimes(2);
  });
});
