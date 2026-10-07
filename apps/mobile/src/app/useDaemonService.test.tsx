import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonServiceApi, ServiceEndReason, ServiceTexts } from '../platform/daemonService';
import { useForegroundStore } from '../stores/foreground';
import { STOP_DELAY_MS } from '../platform/serviceSync';
import { useInteractionStore } from '../stores/interactions';
import { useSessionViewStore } from '../stores/sessionView';
import { STAY_CONNECTED_KEY, useStayConnectedStore } from '../stores/stayConnected';
import { useDaemonService } from './useDaemonService';

const appStateHandlers: Array<(state: { isActive: boolean }) => void> = [];

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((_event: string, handler: (state: { isActive: boolean }) => void) => {
      appStateHandlers.push(handler);
      return Promise.resolve({ remove: () => undefined });
    }),
  },
}));

const resumeApp = () => appStateHandlers.forEach((handler) => handler({ isActive: true }));

function fakeService(stopRequested = false) {
  let ended: ((reason: ServiceEndReason) => void) | undefined;
  let requested = stopRequested;
  const service = {
    isSupported: () => true,
    start: vi.fn(async (_texts: ServiceTexts) => true),
    stop: vi.fn(async () => undefined),
    isRunning: vi.fn(async () => true as boolean | null),
    consumeStopRequest: vi.fn(async () => {
      const value = requested;
      requested = false;
      return value;
    }),
    batteryState: vi.fn(async () => 'unknown' as const),
    openBatterySettings: vi.fn(async () => true),
    onEnded: vi.fn((listener: (reason: ServiceEndReason) => void) => {
      ended = listener;
      return () => undefined;
    }),
  } satisfies DaemonServiceApi;
  return {
    service,
    pressStop: () => {
      requested = true;
      ended?.('stopped');
    },
    androidTimeout: () => ended?.('timeout'),
  };
}

const setTurn = (turnActive: boolean) =>
  useSessionViewStore.setState({
    views: { s1: { id: 's1', turnActive } as never },
  });

describe('useDaemonService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useStayConnectedStore.setState({ enabled: false });
    useSessionViewStore.setState({ views: {} });
    useInteractionStore.setState({ pending: [] });
    appStateHandlers.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('runs the service for a turn and stops it 3 s after the turn ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { service } = fakeService();
    renderHook(() => useDaemonService(service));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(service.start).not.toHaveBeenCalled();

    act(() => setTurn(true));
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(service.start.mock.calls[0]?.[0]).toMatchObject({ stopLabel: 'Stop' });

    act(() => setTurn(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STOP_DELAY_MS - 100);
    });
    expect(service.stop).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  it('runs while stay connected is on and persists the setting', async () => {
    const { service } = fakeService();
    renderHook(() => useDaemonService(service));
    await waitFor(() => expect(service.consumeStopRequest).toHaveBeenCalled());
    act(() => useStayConnectedStore.getState().setEnabled(true));
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(STAY_CONNECTED_KEY)).toBe('true');
  });

  it('applies a stop request from the notification before starting anything', async () => {
    useStayConnectedStore.setState({ enabled: true });
    const { service } = fakeService(true);
    renderHook(() => useDaemonService(service));
    await waitFor(() => expect(useStayConnectedStore.getState().enabled).toBe(false));
    expect(service.start).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STAY_CONNECTED_KEY)).toBe('false');
  });

  it('switches stay connected off and does not restart after Stop is pressed', async () => {
    useStayConnectedStore.setState({ enabled: true });
    const { service, pressStop } = fakeService();
    renderHook(() => useDaemonService(service));
    await waitFor(() => expect(service.start).toHaveBeenCalledTimes(1));
    act(() => pressStop());
    await waitFor(() => expect(useStayConnectedStore.getState().enabled).toBe(false));
    expect(service.start).toHaveBeenCalledTimes(1);
    act(() => resumeApp());
    await act(async () => undefined);
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('restarts on resume when the native service is gone without an event', async () => {
    useStayConnectedStore.setState({ enabled: true });
    const { service } = fakeService();
    renderHook(() => useDaemonService(service));
    await waitFor(() => expect(service.start).toHaveBeenCalledTimes(1));
    service.isRunning.mockResolvedValueOnce(false);
    act(() => resumeApp());
    await waitFor(() => expect(service.start).toHaveBeenCalledTimes(2));
  });

  it('keeps stay connected on after the Android timeout and restarts when the app resumes', async () => {
    useStayConnectedStore.setState({ enabled: true });
    useForegroundStore.setState({ appActive: false });
    const { service, androidTimeout } = fakeService();
    renderHook(() => useDaemonService(service));
    await waitFor(() => expect(service.start).toHaveBeenCalledTimes(1));
    act(() => androidTimeout());
    await act(async () => undefined);
    expect(useStayConnectedStore.getState().enabled).toBe(true);
    expect(service.start).toHaveBeenCalledTimes(1);
    act(() => resumeApp());
    await waitFor(() => expect(service.start).toHaveBeenCalledTimes(2));
    expect(useStayConnectedStore.getState().enabled).toBe(true);
    useForegroundStore.setState({ appActive: true });
  });
});
