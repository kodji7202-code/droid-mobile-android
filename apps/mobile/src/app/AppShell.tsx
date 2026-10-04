import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { ConnectionNotices } from '../components/ConnectionNotices';
import { ConnectionStatusIndicator } from '../components/ConnectionStatusIndicator';
import { NavigationBar, NavigationRail } from '../components/NavItems';
import { useConnectionStore } from '../stores/connection';
import { useAndroidBackHandler } from './useAndroidBackHandler';
import { useMediaQuery } from './useMediaQuery';

/** Route paths that are roots of the four primary destinations. */
export const ROOT_DESTINATIONS = ['/sessions', '/workspace', '/extensions', '/settings'] as const;

export function isRootDestination(pathname: string): boolean {
  return (ROOT_DESTINATIONS as readonly string[]).includes(pathname);
}

/**
 * The app shell: top bar with the connection-status indicator, the routed
 * screen, and navigation that switches between the phone bottom bar and the
 * >= 840 px rail. Without a connection nothing of the shell is reachable:
 * every route redirects to the connect screen.
 */
export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isWideViewport = useMediaQuery('(min-width: 840px)');
  useAndroidBackHandler(navigate, isRootDestination(location.pathname));
  const hasConnection = useConnectionStore((state) => state.connection !== null);

  if (!hasConnection) {
    return <Navigate to="/connect" replace />;
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="app-header">
        <h1 className="app-header__title">{t('app.title')}</h1>
        <ConnectionStatusIndicator />
      </header>
      <ConnectionBanner />
      <div className="app-body">
        {isWideViewport ? <NavigationRail /> : null}
        <main className="app-main" id="main">
          <Outlet />
        </main>
      </div>
      {isWideViewport ? null : <NavigationBar />}
      <ConnectionNotices />
    </div>
  );
}
