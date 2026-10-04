import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';

/**
 * Placeholder for the Sessions list (sessions-list feature builds the real
 * screen). Localized per the mission i18n directive.
 */
export function SessionsScreen() {
  const { t } = useTranslation();
  return (
    <section className="screen" data-testid="sessions-screen" aria-labelledby="sessions-title">
      <h2 className="screen__title" id="sessions-title">
        {t('nav.sessions')}
      </h2>
      <EmptyState title={t('nav.sessions')} message={t('placeholder.message')} />
    </section>
  );
}
