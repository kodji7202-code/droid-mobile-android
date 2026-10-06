import { useTranslation } from 'react-i18next';
import { SettingsSubHeader } from './SettingsSubHeader';

/**
 * Settings > Notifications. The toggles arrive with the background-delivery
 * work; until then the page says that they depend on notifications being on.
 */
export function NotificationsScreen() {
  const { t } = useTranslation();
  return (
    <section className="screen" data-testid="notifications-screen">
      <SettingsSubHeader title={t('notifications.title')} />
      <p className="screen__description" data-testid="notifications-unavailable">
        {t('notifications.unavailable')}
      </p>
    </section>
  );
}
