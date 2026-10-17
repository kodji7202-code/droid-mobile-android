import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPairLinkMemory, usePairLinkStore } from './pairLinkStore';
import { usePairLinkListeners } from './usePairLinkListeners';

const LINK = 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101';

const mocks = vi.hoisted(() => ({
  native: true,
  getLaunchUrl: vi.fn(),
  remove: vi.fn(),
  listener: null as null | ((event: { url: string }) => void),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => mocks.native } };
});
vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.addListener, getLaunchUrl: mocks.getLaunchUrl },
}));

beforeEach(() => {
  mocks.native = true;
  mocks.remove.mockReset();
  mocks.getLaunchUrl.mockReset().mockResolvedValue({ url: LINK });
  mocks.addListener.mockReset().mockImplementation((_event, callback) => {
    mocks.listener = callback;
    return Promise.resolve({ remove: mocks.remove });
  });
  resetPairLinkMemory();
  usePairLinkStore.setState({ pending: null, notice: null });
});

describe('usePairLinkListeners', () => {
  it('turns the cold-start launch URL into a pending link', async () => {
    renderHook(() => usePairLinkListeners());
    await act(async () => undefined);
    expect(usePairLinkStore.getState().pending?.summary.host).toBe('10.0.2.2:3101');
  });

  it('turns a warm appUrlOpen into a pending link', async () => {
    mocks.getLaunchUrl.mockResolvedValue({});
    renderHook(() => usePairLinkListeners());
    await act(async () => undefined);
    expect(usePairLinkStore.getState().pending).toBeNull();
    act(() => mocks.listener?.({ url: LINK }));
    expect(usePairLinkStore.getState().pending?.summary.host).toBe('10.0.2.2:3101');
  });

  it('shows one dialog when the launch URL and the warm delivery overlap', async () => {
    renderHook(() => usePairLinkListeners());
    act(() => mocks.listener?.({ url: LINK }));
    const afterWarm = usePairLinkStore.getState().pending;
    await act(async () => undefined);
    expect(usePairLinkStore.getState().pending).toBe(afterWarm);
  });

  it('removes its listener on unmount', async () => {
    const { unmount } = renderHook(() => usePairLinkListeners());
    await act(async () => undefined);
    unmount();
    await act(async () => undefined);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the web', async () => {
    mocks.native = false;
    renderHook(() => usePairLinkListeners());
    await act(async () => undefined);
    expect(mocks.addListener).not.toHaveBeenCalled();
    expect(usePairLinkStore.getState().pending).toBeNull();
  });

  it('survives a failing getLaunchUrl', async () => {
    mocks.getLaunchUrl.mockRejectedValue(new Error('no intent'));
    renderHook(() => usePairLinkListeners());
    await act(async () => undefined);
    expect(usePairLinkStore.getState().pending).toBeNull();
  });
});
