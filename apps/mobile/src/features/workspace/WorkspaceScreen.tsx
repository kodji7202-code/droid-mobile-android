import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';

/**
 * Placeholder for the Workspace tab (file tree/git/terminals features build
 * the real screen). Localized per the mission i18n directive.
 */
export function WorkspaceScreen() {
  const { t } = useTranslation();
  return (
    <section className="screen" data-testid="workspace-screen" aria-labelledby="workspace-title">
      <h2 className="screen__title" id="workspace-title">
        {t('nav.workspace')}
      </h2>
      <EmptyState title={t('nav.workspace')} message={t('placeholder.message')} />
    </section>
  );
}
