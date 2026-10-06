import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroid } from '@factory/droid-sdk';
import { DaemonClientError } from './errors';
import { createSkillsClient, toSkill } from './skills';

type RawSkill = Parameters<typeof toSkill>[0];

function raw(overrides: Partial<RawSkill> = {}): RawSkill {
  return {
    name: 'tuistory',
    filePath: 'builtin:tuistory',
    location: 'builtin',
    description: 'Automates terminals',
    ...overrides,
  } as RawSkill;
}

function harness(skills: RawSkill[] = [raw()], projectAvailable: boolean | null = true) {
  const closes: string[] = [];
  let next = 0;
  const generation = { value: 1 };
  const api = {
    list: vi.fn(async () => ({ skills, projectAvailable: projectAvailable ?? undefined })),
    setDisabled: vi.fn(async () => ({ success: true })),
  };
  const create = vi.fn(async (_options: { cwd: string }) => {
    const id = `scratch-${++next}`;
    return { id, close: vi.fn(async () => void closes.push(id)) };
  });
  const droid = {
    workspace: {
      validateDirectory: vi.fn(async () => ({ isValid: true, resolvedPath: '/home/user' })),
    },
    sessions: { create },
    skills: api,
  } as unknown as ConnectedDroid;
  const client = createSkillsClient({
    droid: () => droid,
    generation: () => generation.value,
    run: (op) => op(),
  });
  return { client, api, create, closes, generation, droid };
}

describe('toSkill', () => {
  it('keeps the reported fields and treats a missing enabled flag as enabled', () => {
    expect(toSkill(raw())).toEqual({
      name: 'tuistory',
      description: 'Automates terminals',
      location: 'builtin',
      filePath: 'builtin:tuistory',
      enabled: true,
    });
  });

  it('omits the description when the daemon reports none', () => {
    expect('description' in toSkill(raw({ description: undefined }))).toBe(false);
  });

  it('reads the levels of a ledger entry and marks the skill disabled', () => {
    const skill = toSkill(
      raw({
        enabled: false,
        disabledBy: {
          kind: 'ledger',
          sources: [
            { level: 'user', folderPath: 'C:\\Users\\a\\.factory' },
            { level: 'project', folderPath: 'C:\\p\\.factory' },
          ],
        },
      } as Partial<RawSkill>),
    );
    expect(skill.enabled).toBe(false);
    expect(skill.disabledBy).toEqual({ kind: 'ledger', levels: ['user', 'project'] });
  });

  it('marks a skill disabled by its own file', () => {
    const skill = toSkill(raw({ enabled: false, disabledBy: { kind: 'frontmatter' } }));
    expect(skill.enabled).toBe(false);
    expect(skill.disabledBy).toEqual({ kind: 'frontmatter' });
  });

  it('treats a disabledBy entry as disabled even when enabled is absent', () => {
    const skill = toSkill(raw({ disabledBy: { kind: 'frontmatter' } }));
    expect(skill.enabled).toBe(false);
  });

  it('passes an unknown location through unchanged', () => {
    expect(toSkill(raw({ location: 'plugin' as RawSkill['location'] })).location).toBe('plugin');
  });
});

describe('createSkillsClient', () => {
  it('lists through a scratch session in the home folder when no project is given', async () => {
    const { client, api, create, droid } = harness();
    const result = await client.list();
    expect(droid.workspace.validateDirectory).toHaveBeenCalledWith('~');
    expect(create).toHaveBeenCalledWith({ cwd: '/home/user' });
    expect(api.list).toHaveBeenCalledWith('scratch-1');
    expect(result.skills.map((skill) => skill.name)).toEqual(['tuistory']);
  });

  it('opens the session in the given project folder', async () => {
    const { client, create, droid } = harness();
    await client.list('/work/app');
    expect(droid.workspace.validateDirectory).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ cwd: '/work/app' });
  });

  it('reports projectAvailable as the daemon does and false when it is absent', async () => {
    expect((await harness([raw()], true).client.list('/p')).projectAvailable).toBe(true);
    expect((await harness([raw()], false).client.list('/p')).projectAvailable).toBe(false);
    expect((await harness([raw()], null).client.list('/p')).projectAvailable).toBe(false);
  });

  it('reuses the session for the same folder and shares concurrent creation', async () => {
    const { client, create } = harness();
    await Promise.all([client.list('/p'), client.list('/p')]);
    await client.list('/p');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('closes the old session and opens a new one when the folder changes', async () => {
    const { client, create, closes } = harness();
    await client.list('/a');
    await client.list('/b');
    expect(create).toHaveBeenCalledTimes(2);
    expect(closes).toEqual(['scratch-1']);
  });

  it('opens a new session after the connection was replaced', async () => {
    const { client, api, create, generation } = harness();
    await client.list('/p');
    generation.value = 2;
    await client.list('/p');
    expect(create).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenLastCalledWith('scratch-2');
  });

  it('sends the skill name, flag and level for each change', async () => {
    const { client, api } = harness();
    await client.setDisabled({ name: 'tuistory', disabled: true, level: 'user' });
    await client.setDisabled({ name: 'val-proj-skill', disabled: false, level: 'project' }, '/p');
    expect(api.setDisabled).toHaveBeenNthCalledWith(1, {
      sessionId: 'scratch-1',
      skillName: 'tuistory',
      disabled: true,
      settingsLevel: 'user',
    });
    expect(api.setDisabled).toHaveBeenNthCalledWith(2, {
      sessionId: 'scratch-2',
      skillName: 'val-proj-skill',
      disabled: false,
      settingsLevel: 'project',
    });
  });

  it('fails with a classified error when the daemon refuses the change', async () => {
    const { client, api } = harness();
    api.setDisabled.mockResolvedValueOnce({ success: false });
    await expect(
      client.setDisabled({ name: 'tuistory', disabled: true, level: 'user' }),
    ).rejects.toBeInstanceOf(DaemonClientError);
  });

  it('closes the session on release and opens a fresh one afterwards', async () => {
    const { client, create, closes } = harness();
    await client.list();
    await client.release();
    expect(closes).toEqual(['scratch-1']);
    await client.list();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('release without a session is a no-op', async () => {
    const { client, closes } = harness();
    await client.release();
    expect(closes).toEqual([]);
  });
});
