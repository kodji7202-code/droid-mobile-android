import { useTranslation } from 'react-i18next';
import type { Skill } from '@droidmobile/daemon-client';
import { stateSummary } from './skillLogic';

/** Enabled/disabled state as text (never colour alone), naming the level that disabled it. */
export function SkillStateBadge({ skill, testId }: { skill: Skill; testId: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`badge badge--${skill.enabled ? 'success' : 'muted'}`}
      data-testid={testId}
      data-enabled={skill.enabled}
    >
      {t(stateSummary(skill).key)}
    </span>
  );
}
