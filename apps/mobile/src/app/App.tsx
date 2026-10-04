import { Suspense, useMemo } from 'react';
import { RouterProvider, createHashRouter, createMemoryRouter } from 'react-router';
import { Capacitor } from '@capacitor/core';
import { ErrorBoundary } from './ErrorBoundary';
import { createAppRoutes } from './routes';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ToastProvider } from '../components/Toast';
import { Skeleton } from '../components/Skeleton';

/**
 * App root: global error boundary, theme and toast providers, and the router
 * (hash router on web, memory router on Capacitor native — both survive the
 * WebView's file/origin model).
 */
export default function App() {
  const router = useMemo(() => {
    const routes = createAppRoutes();
    return Capacitor.isNativePlatform()
      ? createMemoryRouter(routes, { initialEntries: ['/'] })
      : createHashRouter(routes);
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <Suspense fallback={<Skeleton lines={3} />}>
            <RouterProvider router={router} />
          </Suspense>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
