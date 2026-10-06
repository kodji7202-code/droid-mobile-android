import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Skill, SkillLevel } from '@droidmobile/daemon-client';
import { SkillLevelSheet } from './SkillLevelSheet';
import { toggleBlocked } from './skillLogic';

interface SkillToggleProps {
  skill: Skill;
  busy: boolean;
  projectFolder: string | undefined;
  projectAvailable: boolean;
  onDisable: (skill: Skill, level: SkillLevel) => void;
  onEnable: (skill: Skill) => void;
  /** Suffix for test ids so the list row and the detail view can coexist in one tree. */
  idPrefix?: string;
}

/**
 * Switch for one skill. Switching off opens the level choice first; switching
 * on re-enables at the level(s) that disabled it, with no extra prompt.
 */
export function SkillToggle({
  skill,
  busy,
  projectFolder,
  projectAvailable,
  onDisable,
  onEnable,
  idPrefix = 'skill',
}: SkillToggleProps) {
  const { t } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  const { name } = skill;

  return (
    <div className="mcp-row__toggle">
      {busy ? (
        <span
          className="spinner"
          role="status"
          aria-label={t('skills.working')}
          data-testid={`${idPrefix}-pending-${name}`}
        />
      ) : null}
      <input
        type="checkbox"
        role="switch"
        className="settings-toggle__control"
        data-testid={`${idPrefix}-toggle-${name}`}
        aria-label={t('skills.toggleLabel', { name })}
        checked={skill.enabled}
        aria-checked={skill.enabled}
        disabled={busy || toggleBlocked(skill)}
        onChange={() => (skill.enabled ? setChoosing(true) : onEnable(skill))}
      />
      <SkillLevelSheet
        open={choosing}
        skillName={name}
        projectFolder={projectFolder}
        projectAvailable={projectAvailable}
        onClose={() => setChoosing(false)}
        onConfirm={(level) => {
          setChoosing(false);
          onDisable(skill, level);
        }}
      />
    </div>
  );
}
