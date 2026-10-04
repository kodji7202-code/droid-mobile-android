import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ToastProvider } from '../components/Toast';
import { createAppRoutes } from '../app/routes';

/**
 * Renders the full app route table inside a memory router plus the global
 * providers. Component tests use the same routes as the production app, only
 * the history implementation differs (memory instead of hash).
 */
export function renderAppAt(path: string): ReturnType<typeof render> {
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
