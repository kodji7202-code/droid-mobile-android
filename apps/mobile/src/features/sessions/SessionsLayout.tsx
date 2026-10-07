import { Outlet, useMatch } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SessionsScreen } from './SessionsScreen';
import { useMediaQuery } from '../../app/useMediaQuery';

/**
 * Sessions shell. Phones show either the list or the open chat (pushed route,
 * back returns to the list). From 840 px the list stays on the left and the
 * chat fills the right pane, so picking another session never hides the list.
 */
export function SessionsLayout() {
  const wide = useMediaQuery('(min-width: 840px)');
  const atList = useMatch({ path: '/sessions', end: true }) !== null;

  if (!wide) {
    return atList ? <SessionsScreen /> : <Outlet />;
  }
  return (
    <div className="sessions-layout" data-testid="sessions-layout">
      <SessionsScreen />
      <div className="sessions-detail" data-testid="sessions-detail">
        <Outlet />
      </div>
    </div>
  );
}

/** Detail pane content on tablets before a session is opened. */
export function SessionsDetailPlaceholder() {
  const { t } = useTranslation();
  return (
    <p className="screen__description" data-testid="sessions-select-session">
      {t('sessions.selectSession')}
    </p>
  );
}
