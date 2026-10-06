import { describe, expect, it } from 'vitest';
import type { AvailablePlugin, InstalledPlugin } from '@droidmobile/daemon-client';
import { isPluginActive, mergePlugins, validateMarketplaceRepo } from './pluginLogic';

const available = (name: string, marketplace = 'factory-plugins'): AvailablePlugin => ({
  id: `${name}@${marketplace}`,
  name,
  marketplace,
  description: `${name} description`,
});

const installed = (id: string, overrides: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id,
  scope: 'user',
  version: 'abc',
  source: id.split('@')[1] ?? '',
  active: true,
  reason: 'enabled',
  ...overrides,
});

describe('mergePlugins', () => {
  it('keeps the daemon order of available plugins and marks the installed ones', () => {
    const entries = mergePlugins(
      [available('security-engineer'), available('typescript'), available('core')],
      [installed('typescript@factory-plugins')],
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'security-engineer@factory-plugins',
      'typescript@factory-plugins',
      'core@factory-plugins',
    ]);
    expect(entries.map((entry) => entry.installed !== undefined)).toEqual([false, true, false]);
    expect(entries[1]).toMatchObject({
      name: 'typescript',
      marketplace: 'factory-plugins',
      description: 'typescript description',
    });
  });

  it('appends installed plugins whose marketplace no longer offers them', () => {
    const entries = mergePlugins(
      [available('core')],
      [installed('core@factory-plugins'), installed('orphan@gone', { source: 'gone' })],
    );
    expect(entries.map((entry) => entry.id)).toEqual(['core@factory-plugins', 'orphan@gone']);
    expect(entries[1]).toMatchObject({ name: 'orphan', marketplace: 'gone' });
    expect(entries[1]?.description).toBeUndefined();
  });

  it('is empty when nothing is available or installed', () => {
    expect(mergePlugins([], [])).toEqual([]);
  });
});

describe('isPluginActive', () => {
  it('follows the daemon active flag, treating a missing flag as active', () => {
    expect(isPluginActive(installed('a@m', { active: false, reason: 'not enabled' }))).toBe(false);
    expect(isPluginActive(installed('a@m', { active: true }))).toBe(true);
    const unknown = installed('a@m');
    delete unknown.active;
    expect(isPluginActive(unknown)).toBe(true);
  });
});

describe('validateMarketplaceRepo', () => {
  it('accepts owner/repo and trims whitespace', () => {
    expect(validateMarketplaceRepo('  Factory-AI/factory-plugins ')).toEqual({
      ok: true,
      repo: 'Factory-AI/factory-plugins',
    });
  });

  it('accepts a github URL and reduces it to owner/repo', () => {
    expect(validateMarketplaceRepo('https://github.com/Factory-AI/factory-plugins.git')).toEqual({
      ok: true,
      repo: 'Factory-AI/factory-plugins',
    });
  });

  it('rejects an empty value', () => {
    expect(validateMarketplaceRepo('   ')).toEqual({ ok: false, error: 'required' });
  });

  it.each(['factory-plugins', 'a/b/c', 'owner/', '/repo', 'own er/repo', 'not a url'])(
    'rejects %j as not owner/repo',
    (value) => {
      expect(validateMarketplaceRepo(value)).toEqual({ ok: false, error: 'invalid' });
    },
  );
});
