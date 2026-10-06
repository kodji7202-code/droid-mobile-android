import type { Skill, SkillLevel } from './skills';

/**
 * Pure helpers for integration tests that run against the user's real daemon.
 * They record the state of only the items a test mutates and plan the undo of
 * only those, so unrelated user state is never touched.
 */

const LEVELS: readonly SkillLevel[] = ['user', 'project'];

function ledgerLevels(skill: Skill | undefined): SkillLevel[] {
  if (skill?.disabledBy?.kind !== 'ledger') return [];
  const reported = skill.disabledBy.levels;
  return LEVELS.filter((level) => reported.includes(level));
}

/** Disable levels of each named skill; a skill the daemon does not list records no levels. */
export function snapshotSkillLevels(list: Skill[], names: string[]): Map<string, SkillLevel[]> {
  return new Map(
    names.map((name) => [name, ledgerLevels(list.find((skill) => skill.name === name))]),
  );
}

export interface SkillRestoreStep {
  name: string;
  level: SkillLevel;
  disabled: boolean;
}

/** The setDisabled calls that bring the snapshotted skills back to their recorded levels. */
export function planSkillRestore(
  snapshot: Map<string, SkillLevel[]>,
  current: Skill[],
): SkillRestoreStep[] {
  const steps: SkillRestoreStep[] = [];
  for (const [name, wanted] of snapshot) {
    const now = current.find((skill) => skill.name === name);
    if (!now) continue;
    const have = ledgerLevels(now);
    for (const level of LEVELS) {
      const disabled = wanted.includes(level);
      if (disabled !== have.includes(level)) steps.push({ name, level, disabled });
    }
  }
  return steps;
}

/**
 * The skill a test may toggle: the preferred one when it is enabled at every
 * level, otherwise another enabled non-project skill, so a skill the user
 * disabled on purpose is never the subject of an enable/disable assertion.
 */
export function pickEnabledSkill(list: Skill[], preferred: string): string | undefined {
  const usable = (skill: Skill) =>
    skill.enabled && skill.disabledBy === undefined && skill.location !== 'project';
  const first = list.find((skill) => skill.name === preferred && usable(skill));
  return (first ?? list.find(usable))?.name;
}

/** The plugin lifecycle test mutates the target plugin, so it runs only when the user does not have it. */
export const ownsPluginLifecycle = (preInstalled: string[], pluginId: string): boolean =>
  !preInstalled.includes(pluginId);

export interface PluginCleanupInput {
  preInstalled: string[];
  preMarketplaces: string[];
  currentInstalled: string[];
  currentMarketplaces: string[];
  pluginId: string;
  marketplace: string;
}

/** Cleanup removes the plugin and marketplace only if they were absent before the test. */
export function planPluginCleanup(input: PluginCleanupInput): {
  uninstall: boolean;
  removeMarketplace: boolean;
} {
  return {
    uninstall:
      !input.preInstalled.includes(input.pluginId) &&
      input.currentInstalled.includes(input.pluginId),
    removeMarketplace:
      !input.preMarketplaces.includes(input.marketplace) &&
      input.currentMarketplaces.includes(input.marketplace),
  };
}
