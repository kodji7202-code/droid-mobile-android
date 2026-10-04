import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';

/**
 * Placeholder for the Extensions hub (MCP/skills/plugins features build the
 * real screen). Localized per the mission i18n directive.
 */
export function ExtensionsScreen() {
  const { t } = useTranslation();
  return (
    <section className="screen" data-testid="extensions-screen" aria-labelledby="extensions-title">
      <h2 className="screen__title" id="extensions-title">
        {t('nav.extensions')}
      </h2>
      <EmptyState title={t('nav.extensions')} message={t('placeholder.message')} />
    </section>
  );
}
