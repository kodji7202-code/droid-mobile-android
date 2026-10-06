import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Skill } from '@droidmobile/daemon-client';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { ExtensionsSubHeader } from '../ExtensionsSubHeader';
import { SkillStateBadge } from './SkillStateBadge';
import { SkillToggle } from './SkillToggle';
import { originLabelKey } from './skillLogic';
import { useProjectFolder, useSkills } from './useSkills';

/** Presentational detail of one skill: full description, origin, state and source location. */
export function SkillDetail({ skill }: { skill: Skill }) {
  const { t } = useTranslation();
  return (
    <dl className="skill-detail" data-testid="skill-detail-fields">
      <div className="skill-detail__field">
        <dt>{t('skills.detail.description')}</dt>
        <dd
          className={skill.description ? 'skill-detail__text' : 'field__description'}
          data-testid="skill-detail-description"
        >
          {skill.description || t('skills.noDescription')}
        </dd>
      </div>
      <div className="skill-detail__field">
        <dt>{t('skills.detail.origin')}</dt>
        <dd data-testid="skill-detail-origin" data-location={skill.location}>
          {t(originLabelKey(skill.location))}
        </dd>
      </div>
      <div className="skill-detail__field">
        <dt>{t('skills.detail.state')}</dt>
        <dd>
          <SkillStateBadge skill={skill} testId="skill-detail-state" />
        </dd>
      </div>
      <div className="skill-detail__field">
        <dt>{t('skills.detail.source')}</dt>
        <dd className="skill-detail__path" data-testid="skill-detail-source">
          {skill.filePath}
        </dd>
      </div>
    </dl>
  );
}

/** One skill of the open project, with the same enable switch as the list. */
export function SkillDetailScreen() {
  const { t } = useTranslation();
  const { name = '' } = useParams();
  const connection = useConnectionStore((state) => state.connection);
  const projectFolder = useProjectFolder();
  const skills = useSkills(connection, projectFolder);
  const { state } = skills;
  const skill =
    state.status === 'ready' ? state.skills.find((item) => item.name === name) : undefined;

  return (
    <section className="screen" data-testid="skill-detail" aria-label={name}>
      <ExtensionsSubHeader title={name} backTo="/extensions/skills" />
      {state.status === 'loading' ? (
        <div role="status" data-testid="skill-detail-loading" aria-label={t('skills.loading')}>
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <ErrorState
          title={t('skills.loadFailedTitle')}
          message={t('skills.loadFailed')}
          onRetry={skills.retry}
          retryLabel={t('common.retry')}
        />
      ) : null}
      {state.status === 'ready' && !skill ? (
        <div data-testid="skill-detail-missing">
          <EmptyState
            title={t('skills.detail.missingTitle')}
            message={t('skills.detail.missing', { name })}
          />
        </div>
      ) : null}
      {skills.error ? (
        <p role="alert" className="field__error" data-testid="skills-action-error">
          {t(`skills.errors.${skills.error.action}`, { name: skills.error.name })}
        </p>
      ) : null}
      {skill && state.status === 'ready' ? (
        <>
          <SkillToggle
            skill={skill}
            busy={skills.busy.has(skill.name)}
            projectFolder={projectFolder}
            projectAvailable={state.projectAvailable}
            onDisable={(item, level) => void skills.disable(item, level)}
            onEnable={(item) => void skills.enable(item)}
            idPrefix="skill-detail"
          />
          <SkillDetail skill={skill} />
        </>
      ) : null}
    </section>
  );
}
