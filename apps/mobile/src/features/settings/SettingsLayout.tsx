import { Outlet, useMatch } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SettingsScreen } from './SettingsScreen';
import { useMediaQuery } from '../../app/useMediaQuery';

/**
 * Settings shell. Phones show either the section list or one page (pushed
 * route, back returns to the list). From 840 px the list stays on the left and
 * the open page fills the right pane (master-detail).
 */
export function SettingsLayout() {
  const wide = useMediaQuery('(min-width: 840px)');
  const atLanding = useMatch({ path: '/settings', end: true }) !== null;

  if (!wide) {
    return atLanding ? <SettingsScreen /> : <Outlet />;
  }
  return (
    <div className="settings-layout" data-testid="settings-layout">
      <SettingsScreen />
      <div className="settings-detail" data-testid="settings-detail">
        <Outlet />
      </div>
    </div>
  );
}

/** Detail pane content on tablets before a section is opened. */
export function SettingsDetailPlaceholder() {
  const { t } = useTranslation();
  return (
    <p className="screen__description" data-testid="settings-select-section">
      {t('settings.selectSection')}
    </p>
  );
}
