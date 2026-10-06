import type { Skill, SkillLevel } from '@droidmobile/daemon-client';

const KNOWN_ORIGINS = new Set(['builtin', 'personal', 'project', 'automation']);

/** i18n key of the origin label; an origin the app does not know gets a neutral label. */
export function originLabelKey(location: string): string {
  return KNOWN_ORIGINS.has(location) ? `skills.origin.${location}` : 'skills.origin.unknown';
}

/** Levels at which this skill is switched off and where the daemon accepts a change. */
export function disabledLevels(skill: Skill): SkillLevel[] {
  if (skill.enabled || skill.disabledBy?.kind !== 'ledger') return [];
  return skill.disabledBy.levels.filter(
    (level): level is SkillLevel => level === 'user' || level === 'project',
  );
}

/** A disabled skill is only switchable when the app can undo the level that disabled it. */
export function toggleBlocked(skill: Skill): boolean {
  return !skill.enabled && disabledLevels(skill).length === 0;
}

export function stateSummary(skill: Skill): { key: string } {
  if (skill.enabled) return { key: 'skills.state.enabled' };
  if (skill.disabledBy?.kind === 'frontmatter') return { key: 'skills.state.disabledFile' };
  const levels = disabledLevels(skill);
  if (levels.length > 1) return { key: 'skills.state.disabledBoth' };
  if (levels[0] === 'user') return { key: 'skills.state.disabledUser' };
  if (levels[0] === 'project') return { key: 'skills.state.disabledProject' };
  return { key: 'skills.state.disabled' };
}
