import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../test/render-app';
import { useConnectionStore } from '../stores/connection';
import { createAppRoutes } from './routes';

const backButtonHandlers: Array<() => void> = [];
const exitApp = vi.fn();

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((_event: string, handler: () => void) => {
      backButtonHandlers.push(handler);
      return Promise.resolve({ remove: () => undefined });
    }),
    exitApp: (...args: unknown[]) => exitApp(...args),
  },
}));

function pressBack() {
  act(() => {
    backButtonHandlers[backButtonHandlers.length - 1]();
  });
}

async function renderNative(entry: string) {
  useConnectionStore.setState({ connection: {} as DaemonConnection });
  const router = createMemoryRouter(createAppRoutes(), { initialEntries: [entry] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return router;
}

describe('AppShell hardware Back on the native memory router (VAL-WS-019)', () => {
  beforeEach(() => {
    backButtonHandlers.length = 0;
    exitApp.mockReset();
    // The Android WebView reports a single entry no matter what the memory router holds.
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
  });

  it('pops viewer -> tree -> previous screen and exits only at Sessions', async () => {
    const router = await renderNative('/sessions');
    await act(() => router.navigate('/workspace'));
    await act(() =>
      router.navigate('/workspace?file=a%2Fb%2Fc.txt', { state: { overlayPushed: true } }),
    );
    expect(screen.getByTestId('workspace-screen')).toBeInTheDocument();

    pressBack();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/workspace'));
    expect(router.state.location.search).toBe('');

    pressBack();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sessions'));

    pressBack();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('falls back to Sessions for a screen reached without in-app history', async () => {
    const router = await renderNative('/settings');
    pressBack();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sessions'));
    expect(exitApp).not.toHaveBeenCalled();
  });
});
