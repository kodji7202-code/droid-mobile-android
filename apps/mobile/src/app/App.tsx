import { Suspense, useMemo } from 'react';
import { RouterProvider, createHashRouter, createMemoryRouter } from 'react-router';
import { Capacitor } from '@capacitor/core';
import { ErrorBoundary } from './ErrorBoundary';
import { createAppRoutes } from './routes';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ToastProvider } from '../components/Toast';
import { LockGate } from '../features/lock/LockGate';
import { Skeleton } from '../components/Skeleton';
import { useAppResume } from './useAppResume';

/**
 * App root: global error boundary, theme and toast providers, and the router
 * (hash router on web, memory router on Capacitor native — both survive the
 * WebView's file/origin model).
 */
export default function App() {
  useAppResume();
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
            <LockGate>
              <RouterProvider router={router} />
            </LockGate>
          </Suspense>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
