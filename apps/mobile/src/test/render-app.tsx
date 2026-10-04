import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ToastProvider } from '../components/Toast';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { createAppRoutes } from '../app/routes';
import { useConnectionStore } from '../stores/connection';

/**
 * Renders the full app route table inside a memory router plus the global
 * providers. Component tests use the same routes as the production app, only
 * the history implementation differs (memory instead of hash). The shell is
 * only reachable with a connection, so one is seeded unless `connected` is
 * false.
 */
export function renderAppAt(
  path: string,
  { connected = true }: { connected?: boolean } = {},
): ReturnType<typeof render> {
  if (connected) {
    // Shell tests never call into the connection; an empty stand-in is enough.
    useConnectionStore.setState({ connection: {} as DaemonConnection });
  }
  const router = createMemoryRouter(createAppRoutes(), {
    initialEntries: [path],
  });
  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

/** Global providers only, for rendering a single screen in isolation. */
export function AppProviders({ children }: { children: ReactElement }) {
  return (
    <ThemeProvider>
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  );
}
