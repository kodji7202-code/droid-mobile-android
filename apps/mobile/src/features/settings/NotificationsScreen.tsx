import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SettingsSubHeader } from './SettingsSubHeader';
import { ChevronRightIcon } from '../../components/icons';
import { daemonService } from '../../platform/daemonService';
import { useStayConnectedStore } from '../../stores/stayConnected';

/**
 * Settings > Notifications: "Stay connected" (keeps the Android foreground service running
 * without a turn) and the entry to the battery-optimisation guidance. The per-channel
 * toggles arrive with the notification channels; until then the page says that they depend
 * on notifications being on.
 */
export function NotificationsScreen() {
  const { t } = useTranslation();
  const enabled = useStayConnectedStore((state) => state.enabled);
  const setEnabled = useStayConnectedStore((state) => state.setEnabled);
  const supported = daemonService.isSupported();

  return (
    <section className="screen" data-testid="notifications-screen">
      <SettingsSubHeader title={t('notifications.title')} />
      <p className="screen__description" data-testid="notifications-unavailable">
        {t('notifications.unavailable')}
      </p>
      <div className="field">
        <div className="settings-toggle">
          <label className="field__label" htmlFor="settings-stay-connected">
            {t('notifications.stayConnected')}
          </label>
          <input
            id="settings-stay-connected"
            type="checkbox"
            role="switch"
            className="settings-toggle__control"
            data-testid="settings-stay-connected-toggle"
            checked={enabled}
            aria-checked={enabled}
            disabled={!supported}
            aria-describedby="settings-stay-connected-description"
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </div>
        <p className="field__description" id="settings-stay-connected-description">
          {t('notifications.stayConnectedDescription')}
        </p>
        {supported ? null : (
          <p className="field__description" data-testid="settings-stay-connected-unavailable">
            {t('notifications.stayConnectedUnavailable')}
          </p>
        )}
      </div>
      <NavLink
        to="/settings/notifications/battery"
        className="settings-row"
        data-testid="settings-battery-guidance"
      >
        <span>{t('notifications.batteryGuidance')}</span>
        <ChevronRightIcon className="settings-row__chevron" />
      </NavLink>
    </section>
  );
}
