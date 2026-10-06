import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { ExtensionsSubHeader } from '../ExtensionsSubHeader';
import { SkillRow } from './SkillRow';
import { useProjectFolder, useSkills } from './useSkills';

/** Extensions > Skills: the daemon's skills for the open project, with origin and enable switch. */
export function SkillsScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const projectFolder = useProjectFolder();
  const skills = useSkills(connection, projectFolder);
  const { state } = skills;
  const list = state.status === 'ready' ? state.skills : [];
  const projectAvailable = state.status === 'ready' && state.projectAvailable;

  return (
    <section
      className="screen"
      data-testid="skills-screen"
      aria-label={t('extensions.skills.title')}
    >
      <ExtensionsSubHeader title={t('extensions.skills.title')} backTo="/extensions" />
      <p className="field__description" data-testid="skills-scope">
        {projectFolder
          ? t('skills.scope.project', { folder: projectFolder })
          : t('skills.scope.none')}
      </p>
      {state.status === 'loading' ? (
        <div role="status" data-testid="skills-loading" aria-label={t('skills.loading')}>
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div data-testid="skills-error">
          <ErrorState
            title={t('skills.loadFailedTitle')}
            message={t('skills.loadFailed')}
            onRetry={skills.retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {skills.error ? (
        <p role="alert" className="field__error" data-testid="skills-action-error">
          {t(`skills.errors.${skills.error.action}`, { name: skills.error.name })}
        </p>
      ) : null}
      {state.status === 'ready' && list.length === 0 ? (
        <div data-testid="skills-empty">
          <EmptyState title={t('skills.empty.title')} message={t('skills.empty.message')} />
        </div>
      ) : null}
      {list.length > 0 ? (
        <ul
          className="mcp-list"
          data-testid="skills-list"
          aria-label={t('extensions.skills.title')}
        >
          {list.map((skill) => (
            <SkillRow
              key={`${skill.location}:${skill.name}`}
              skill={skill}
              busy={skills.busy.has(skill.name)}
              projectFolder={projectFolder}
              projectAvailable={projectAvailable}
              onDisable={(item, level) => void skills.disable(item, level)}
              onEnable={(item) => void skills.enable(item)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
