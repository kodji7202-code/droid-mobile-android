import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useAndroidBackHandler } from './useAndroidBackHandler';

const backButtonHandlers: Array<() => void> = [];
const exitApp = vi.fn();
const navigateCalls: unknown[][] = [];

vi.mock('@capacitor/core', () => ({
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

function Probe({ isAtRoot }: { isAtRoot: boolean }) {
  const navigate = useNavigate();
  useAndroidBackHandler((delta: number) => {
    navigateCalls.push([delta]);
    void navigate(delta);
  }, isAtRoot);
  return null;
}

/** Routes where the second entry is a pushed detail route. */
function renderProbe(isAtRoot: boolean) {
  const router = createMemoryRouter(
    [
      { path: 'sessions', element: <Probe isAtRoot={isAtRoot} /> },
      { path: 'sessions/:id', element: <Probe isAtRoot={isAtRoot} /> },
    ],
    { initialEntries: ['/sessions', '/sessions/abc'], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('useAndroidBackHandler', () => {
  beforeEach(() => {
    backButtonHandlers.length = 0;
    navigateCalls.length = 0;
    exitApp.mockReset();
  });

  afterEach(() => {
    backButtonHandlers.length = 0;
    navigateCalls.length = 0;
  });

  it('navigates back in history when not at a root destination', () => {
    const router = renderProbe(false);
    expect(backButtonHandlers).toHaveLength(1);
    backButtonHandlers[0]();
    expect(navigateCalls).toHaveLength(1);
    expect(exitApp).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/sessions');
  });

  it('exits the app instead when already at a root destination', () => {
    renderProbe(true);
    expect(backButtonHandlers).toHaveLength(1);
    backButtonHandlers[0]();
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(navigateCalls).toHaveLength(0);
  });
});
