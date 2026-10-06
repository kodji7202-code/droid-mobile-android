import { describe, expect, it } from 'vitest';
import type { Skill } from '@droidmobile/daemon-client';
import { disabledLevels, originLabelKey, stateSummary, toggleBlocked } from './skillLogic';

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 's',
    location: 'builtin',
    filePath: 'builtin:s',
    enabled: true,
    ...overrides,
  };
}

describe('originLabelKey', () => {
  it.each([
    ['builtin', 'skills.origin.builtin'],
    ['personal', 'skills.origin.personal'],
    ['project', 'skills.origin.project'],
    ['automation', 'skills.origin.automation'],
  ])('maps %s one-to-one to its own label', (location, key) => {
    expect(originLabelKey(location)).toBe(key);
  });

  it('uses the neutral label for a value it does not know', () => {
    expect(originLabelKey('plugin')).toBe('skills.origin.unknown');
    expect(originLabelKey('')).toBe('skills.origin.unknown');
  });

  it('gives the four known values four different labels', () => {
    const keys = ['builtin', 'personal', 'project', 'automation'].map(originLabelKey);
    expect(new Set(keys).size).toBe(4);
  });
});

describe('disabledLevels', () => {
  it('lists the ledger levels the app can write', () => {
    expect(
      disabledLevels(skill({ enabled: false, disabledBy: { kind: 'ledger', levels: ['user'] } })),
    ).toEqual(['user']);
    expect(
      disabledLevels(
        skill({ enabled: false, disabledBy: { kind: 'ledger', levels: ['project', 'user'] } }),
      ),
    ).toEqual(['project', 'user']);
  });

  it('drops levels the daemon accepts no change for', () => {
    expect(
      disabledLevels(skill({ enabled: false, disabledBy: { kind: 'ledger', levels: ['org'] } })),
    ).toEqual([]);
  });

  it('is empty for an enabled skill and a file-disabled skill', () => {
    expect(disabledLevels(skill())).toEqual([]);
    expect(disabledLevels(skill({ enabled: false, disabledBy: { kind: 'frontmatter' } }))).toEqual(
      [],
    );
  });
});

describe('toggleBlocked', () => {
  it('blocks a skill the app cannot re-enable', () => {
    expect(toggleBlocked(skill({ enabled: false, disabledBy: { kind: 'frontmatter' } }))).toBe(
      true,
    );
    expect(
      toggleBlocked(skill({ enabled: false, disabledBy: { kind: 'ledger', levels: ['org'] } })),
    ).toBe(true);
  });

  it('allows enabled skills and skills disabled at a writable level', () => {
    expect(toggleBlocked(skill())).toBe(false);
    expect(
      toggleBlocked(skill({ enabled: false, disabledBy: { kind: 'ledger', levels: ['user'] } })),
    ).toBe(false);
  });
});

describe('stateSummary', () => {
  it('names the level a skill is disabled at', () => {
    expect(
      stateSummary(skill({ enabled: false, disabledBy: { kind: 'ledger', levels: ['user'] } })),
    ).toEqual({ key: 'skills.state.disabledUser' });
    expect(
      stateSummary(skill({ enabled: false, disabledBy: { kind: 'ledger', levels: ['project'] } })),
    ).toEqual({ key: 'skills.state.disabledProject' });
  });

  it('reports a skill disabled at both levels', () => {
    expect(
      stateSummary(
        skill({ enabled: false, disabledBy: { kind: 'ledger', levels: ['user', 'project'] } }),
      ),
    ).toEqual({ key: 'skills.state.disabledBoth' });
  });

  it('distinguishes file-disabled, other-level and plain states', () => {
    expect(stateSummary(skill({ enabled: false, disabledBy: { kind: 'frontmatter' } }))).toEqual({
      key: 'skills.state.disabledFile',
    });
    expect(stateSummary(skill({ enabled: false }))).toEqual({ key: 'skills.state.disabled' });
    expect(stateSummary(skill())).toEqual({ key: 'skills.state.enabled' });
  });
});
