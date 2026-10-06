import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Skill, SkillLevel } from '@droidmobile/daemon-client';
import { ChevronRightIcon } from '../../../components/icons';
import { SkillStateBadge } from './SkillStateBadge';
import { SkillToggle } from './SkillToggle';
import { originLabelKey } from './skillLogic';

interface SkillRowProps {
  skill: Skill;
  busy: boolean;
  projectFolder: string | undefined;
  projectAvailable: boolean;
  onDisable: (skill: Skill, level: SkillLevel) => void;
  onEnable: (skill: Skill) => void;
}

export function SkillRow({
  skill,
  busy,
  projectFolder,
  projectAvailable,
  onDisable,
  onEnable,
}: SkillRowProps) {
  const { t } = useTranslation();
  const { name } = skill;
  return (
    <li className="mcp-row" data-testid={`skill-row-${name}`}>
      <Link
        to={`/extensions/skills/${encodeURIComponent(name)}`}
        className="mcp-row__main"
        data-testid={`skill-open-${name}`}
      >
        <span className="mcp-row__text">
          <span className="mcp-row__name">{name}</span>
          <span
            className={skill.description ? 'skill-row__description' : 'field__description'}
            data-testid={`skill-description-${name}`}
          >
            {skill.description || t('skills.noDescription')}
          </span>
          <span className="mcp-row__meta">
            <span
              className="chip"
              data-testid={`skill-origin-${name}`}
              data-location={skill.location}
            >
              {t(originLabelKey(skill.location))}
            </span>
            <SkillStateBadge skill={skill} testId={`skill-state-${name}`} />
          </span>
        </span>
        <ChevronRightIcon className="settings-row__chevron" />
      </Link>
      <div className="mcp-row__actions">
        <SkillToggle
          skill={skill}
          busy={busy}
          projectFolder={projectFolder}
          projectAvailable={projectAvailable}
          onDisable={onDisable}
          onEnable={onEnable}
        />
      </div>
    </li>
  );
}
