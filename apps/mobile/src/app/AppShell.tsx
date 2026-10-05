import { useRef } from 'react';
import {
  matchPath,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { ConnectionNotices } from '../components/ConnectionNotices';
import { ConnectionStatusIndicator } from '../components/ConnectionStatusIndicator';
import { NavigationBar, NavigationRail } from '../components/NavItems';
import { useConnectionStore } from '../stores/connection';
import { useInteractionStore } from '../stores/interactions';
import { useAndroidBackHandler } from './useAndroidBackHandler';
import { useMediaQuery } from './useMediaQuery';

/** Route paths that are roots of the primary destinations where back exits the app. */
export const ROOT_DESTINATIONS = ['/sessions'] as const;

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
  const navigationType = useNavigationType();
  const isWideViewport = useMediaQuery('(min-width: 840px)');
  // The native router is a memory router, so window.history says nothing about in-app history.
  const historyDepth = useRef(0);
  const lastKey = useRef(location.key);
  if (lastKey.current !== location.key) {
    lastKey.current = location.key;
    if (navigationType === 'PUSH') historyDepth.current += 1;
    else if (navigationType === 'POP') historyDepth.current = Math.max(0, historyDepth.current - 1);
  }
  const handleAndroidBack = (delta: number) => {
    if (historyDepth.current === 0 && location.pathname !== '/sessions') {
      void navigate('/sessions', { replace: true });
    } else {
      void navigate(delta);
    }
  };
  useAndroidBackHandler(handleAndroidBack, isRootDestination(location.pathname));
  const hasConnection = useConnectionStore((state) => state.connection !== null);
  const openSessionId = matchPath('/sessions/:id', location.pathname)?.params.id;
  // The request dialog of the open session is modal: only it (and Stop inside it) stays operable.
  const modalOpen = useInteractionStore((state) =>
    state.pending.some((item) => item.sessionId === openSessionId),
  );

  if (!hasConnection) {
    return <Navigate to="/connect" replace />;
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="app-header" inert={modalOpen}>
        <h1 className="app-header__title">{t('app.title')}</h1>
        <ConnectionStatusIndicator />
      </header>
      <div style={{ display: 'contents' }} inert={modalOpen}>
        <ConnectionBanner />
      </div>
      <div className="app-body">
        {isWideViewport ? (
          <div style={{ display: 'contents' }} inert={modalOpen}>
            <NavigationRail />
          </div>
        ) : null}
        <main className="app-main" id="main">
          <Outlet />
        </main>
      </div>
      {isWideViewport ? null : (
        <div style={{ display: 'contents' }} inert={modalOpen}>
          <NavigationBar />
        </div>
      )}
      <ConnectionNotices />
    </div>
  );
}
