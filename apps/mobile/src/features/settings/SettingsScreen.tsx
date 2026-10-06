import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon } from '../../components/icons';

const SECTIONS = [
  { to: '/settings/connection', testId: 'settings-connection', labelKey: 'settings.connection' },
  { to: '/settings/security', testId: 'settings-security', labelKey: 'settings.security' },
  {
    to: '/settings/notifications',
    testId: 'settings-notifications',
    labelKey: 'settings.notifications',
  },
  { to: '/settings/appearance', testId: 'settings-appearance', labelKey: 'settings.appearance' },
  { to: '/settings/language', testId: 'settings-language', labelKey: 'settings.language' },
  { to: '/settings/defaults', testId: 'settings-defaults', labelKey: 'settings.defaults' },
  { to: '/settings/about', testId: 'settings-about', labelKey: 'settings.about' },
] as const;

/**
 * The Settings section list: the landing page on phones and the master pane on
 * tablets. Each row is a full-width link with a >= 48 dp touch target, and the
 * row of the open page is marked with aria-current.
 */
export function SettingsScreen() {
  const { t } = useTranslation();

  return (
    <section
      className="screen settings-landing"
      data-testid="settings-screen"
      aria-labelledby="settings-title"
    >
      <h2 className="screen__title" id="settings-title">
        {t('settings.title')}
      </h2>
      <nav aria-label={t('settings.title')}>
        <ul className="settings-list">
          {SECTIONS.map((section) => (
            <li key={section.to}>
              <NavLink to={section.to} className="settings-row" data-testid={section.testId}>
                <span>{t(section.labelKey)}</span>
                <ChevronRightIcon className="settings-row__chevron" />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
