import { describe, expect, it } from 'vitest';
import type { Skill } from './skills';
import {
  ownsPluginLifecycle,
  pickEnabledSkill,
  planPluginCleanup,
  planSkillRestore,
  snapshotSkillLevels,
} from './integration-restore';

const skill = (name: string, levels: string[] = [], location = 'personal'): Skill => ({
  name,
  location,
  filePath: `/skills/${name}/SKILL.md`,
  enabled: levels.length === 0,
  ...(levels.length > 0 ? { disabledBy: { kind: 'ledger' as const, levels } } : {}),
});

describe('skill snapshot and restore', () => {
  it('records only the named skills and keeps unrelated disabled skills out of the plan', () => {
    const before = [skill('mine'), skill('theirs', ['user']), skill('also-theirs', ['project'])];
    const snapshot = snapshotSkillLevels(before, ['mine']);
    expect([...snapshot.keys()]).toEqual(['mine']);

    const current = [
      skill('mine', ['user', 'project']),
      skill('theirs', ['user']),
      skill('also-theirs', ['project']),
    ];
    expect(planSkillRestore(snapshot, current)).toEqual([
      { name: 'mine', level: 'user', disabled: false },
      { name: 'mine', level: 'project', disabled: false },
    ]);
  });

  it('plans nothing when the mutated skills are already back in their prior state', () => {
    const before = [skill('mine'), skill('theirs', ['user'])];
    const snapshot = snapshotSkillLevels(before, ['mine']);
    expect(planSkillRestore(snapshot, before)).toEqual([]);
  });

  it('restores a target that was already disabled at one level instead of enabling it', () => {
    const snapshot = snapshotSkillLevels([skill('mine', ['user'])], ['mine']);
    const afterReEnable = [skill('mine')];
    expect(planSkillRestore(snapshot, afterReEnable)).toEqual([
      { name: 'mine', level: 'user', disabled: true },
    ]);
    const afterExtraProjectLevel = [skill('mine', ['user', 'project'])];
    expect(planSkillRestore(snapshot, afterExtraProjectLevel)).toEqual([
      { name: 'mine', level: 'project', disabled: false },
    ]);
  });

  it('ignores frontmatter-disabled skills and skills missing from the current list', () => {
    const frontmatter: Skill = {
      name: 'fm',
      location: 'personal',
      filePath: '/fm',
      enabled: false,
      disabledBy: { kind: 'frontmatter' },
    };
    const snapshot = snapshotSkillLevels([frontmatter], ['fm', 'gone']);
    expect(snapshot.get('fm')).toEqual([]);
    expect(snapshot.get('gone')).toEqual([]);
    expect(planSkillRestore(snapshot, [frontmatter])).toEqual([]);
  });
});

describe('pickEnabledSkill', () => {
  it('prefers the named skill when it is enabled everywhere', () => {
    expect(pickEnabledSkill([skill('a'), skill('tuistory')], 'tuistory')).toBe('tuistory');
  });

  it('falls back to another enabled skill when the preferred one is already disabled', () => {
    expect(pickEnabledSkill([skill('tuistory', ['user']), skill('b')], 'tuistory')).toBe('b');
  });

  it('never picks a project skill or a frontmatter-disabled one', () => {
    const fm: Skill = { ...skill('fm'), enabled: false, disabledBy: { kind: 'frontmatter' } };
    expect(pickEnabledSkill([skill('p', [], 'project'), fm], 'x')).toBeUndefined();
  });
});

describe('plugin lifecycle ownership and cleanup', () => {
  const ID = 'typescript@factory-plugins';
  const MP = 'factory-plugins';

  it('owns the lifecycle only when the target plugin was not installed beforehand', () => {
    expect(ownsPluginLifecycle(['other@x'], ID)).toBe(true);
    expect(ownsPluginLifecycle(['other@x', ID], ID)).toBe(false);
  });

  it('uninstalls and removes only what the test introduced', () => {
    expect(
      planPluginCleanup({
        preInstalled: [],
        preMarketplaces: [],
        currentInstalled: [ID],
        currentMarketplaces: [MP],
        pluginId: ID,
        marketplace: MP,
      }),
    ).toEqual({ uninstall: true, removeMarketplace: true });
  });

  it('leaves a pre-installed plugin and a pre-existing marketplace alone', () => {
    expect(
      planPluginCleanup({
        preInstalled: [ID, 'other@x'],
        preMarketplaces: [MP, 'x'],
        currentInstalled: [ID, 'other@x'],
        currentMarketplaces: [MP, 'x'],
        pluginId: ID,
        marketplace: MP,
      }),
    ).toEqual({ uninstall: false, removeMarketplace: false });
  });

  it('keeps a pre-existing marketplace when the plugin was installed by the test', () => {
    expect(
      planPluginCleanup({
        preInstalled: ['other@x'],
        preMarketplaces: [MP],
        currentInstalled: [ID, 'other@x'],
        currentMarketplaces: [MP],
        pluginId: ID,
        marketplace: MP,
      }),
    ).toEqual({ uninstall: true, removeMarketplace: false });
  });

  it('does nothing when the introduced items are already gone', () => {
    expect(
      planPluginCleanup({
        preInstalled: [],
        preMarketplaces: [],
        currentInstalled: [],
        currentMarketplaces: [],
        pluginId: ID,
        marketplace: MP,
      }),
    ).toEqual({ uninstall: false, removeMarketplace: false });
  });
});
