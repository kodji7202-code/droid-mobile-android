import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon } from '../../components/icons';

/**
 * Settings landing (stub: the sections their features add land here).
 * Each row is a full-width link with a >= 48 dp touch target.
 */
export function SettingsScreen() {
  const { t } = useTranslation();
  const sections = [
    { to: '/settings/appearance', testId: 'settings-appearance', label: t('settings.appearance') },
    { to: '/settings/language', testId: 'settings-language', label: t('settings.language') },
  ];

  return (
    <section className="screen" data-testid="settings-screen" aria-labelledby="settings-title">
      <h2 className="screen__title" id="settings-title">
        {t('settings.title')}
      </h2>
      <nav aria-label={t('settings.title')}>
        <ul className="settings-list">
          {sections.map((section) => (
            <li key={section.to}>
              <Link to={section.to} className="settings-row" data-testid={section.testId}>
                <span>{section.label}</span>
                <ChevronRightIcon className="settings-row__chevron" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
