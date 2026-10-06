/**
 * Integration tests for skill listing and enablement against the REAL daemon on
 * 127.0.0.1:3101. The disable levels of only the two skills the tests toggle
 * are recorded first and restored in `afterAll`; every other skill, disabled or
 * not, is left as the user has it. No model prompt is sent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import type { DaemonConnection } from './connection';
import type { Skill, SkillLevel } from './skills';
import { removeScratchDir } from './integration-cleanup';
import { pickEnabledSkill, planSkillRestore, snapshotSkillLevels } from './integration-restore';

const DAEMON_URL = process.env.DC_TEST_DAEMON_URL ?? 'ws://127.0.0.1:3101';
const API_KEY = process.env.FACTORY_API_KEY;

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local and start services.droid-daemon-test (see services.yaml).',
  );
}

const PROJECT_SKILL = 'val-proj-skill';
const open: DaemonConnection[] = [];
let projectDir = '';
let otherDir = '';
let preDisabled: string[] = [];
/** A real skill the user has not disabled at any level, chosen in `beforeAll`. */
let TARGET = '';
let preLevels = new Map<string, SkillLevel[]>();

async function connect(): Promise<DaemonConnection> {
  const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY!, keepAliveMs: 0 });
  await conn.connect();
  open.push(conn);
  return conn;
}

/** An independent read: a new connection and scratch session, since other sessions lag behind. */
async function independent(cwd?: string): Promise<Skill[]> {
  const conn = await connect();
  try {
    return (await conn.skills.list(cwd)).skills;
  } finally {
    await conn.skills.release().catch(() => undefined);
    conn.disconnect();
  }
}

const find = (list: Skill[], name: string) => list.find((skill) => skill.name === name);
const disabledNames = (list: Skill[]) =>
  list
    .filter((skill) => !skill.enabled)
    .map((skill) => skill.name)
    .sort();

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'val-skills-int-'));
  otherDir = await mkdtemp(join(tmpdir(), 'val-skills-other-'));
  const dir = join(projectDir, '.factory', 'skills', PROJECT_SKILL);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${PROJECT_SKILL}\ndescription: Validation project skill\n---\nDo nothing.\n`,
  );
  const before = await independent(projectDir);
  const target = pickEnabledSkill(before, 'tuistory');
  if (!target) throw new Error('No skill that is enabled at every level is available to toggle.');
  TARGET = target;
  preLevels = snapshotSkillLevels(before, [TARGET, PROJECT_SKILL]);
  preDisabled = disabledNames(await independent());
}, 30_000);

afterAll(async () => {
  const conn = await connect();
  const current = (await conn.skills.list(projectDir)).skills;
  for (const step of planSkillRestore(preLevels, current)) {
    await conn.skills.setDisabled(step, projectDir);
  }
  await conn.skills.release().catch(() => undefined);
  for (const item of open) item.disconnect();
  await removeScratchDir(projectDir);
  await removeScratchDir(otherDir);
  expect(disabledNames(await independent())).toEqual(preDisabled);
}, 30_000);

describe('skills against the real daemon', { timeout: 30_000 }, () => {
  it('lists built-in, personal and project skills with origins and paths', async () => {
    const list = await independent(projectDir);
    const project = find(list, PROJECT_SKILL);
    expect(project).toMatchObject({
      location: 'project',
      enabled: true,
      description: 'Validation project skill',
    });
    expect(project?.filePath).toContain('SKILL.md');
    expect(new Set(list.map((skill) => skill.location))).toContain('builtin');
    const builtin = list.find((skill) => skill.location === 'builtin');
    expect(builtin?.filePath).toBe(`builtin:${builtin?.name}`);
  });

  it('reports projectAvailable only for a project folder', async () => {
    const conn = await connect();
    expect((await conn.skills.list(projectDir)).projectAvailable).toBe(true);
    expect((await conn.skills.list()).projectAvailable).toBe(false);
    await conn.skills.release();
  });

  it('disables at user level for every folder and re-enables', async () => {
    const conn = await connect();
    await conn.skills.setDisabled({ name: TARGET, disabled: true, level: 'user' }, projectDir);
    const other = find(await independent(otherDir), TARGET);
    expect(other).toMatchObject({ enabled: false, disabledBy: { kind: 'ledger' } });
    expect(other?.disabledBy).toEqual({ kind: 'ledger', levels: ['user'] });
    await conn.skills.setDisabled({ name: TARGET, disabled: false, level: 'user' }, projectDir);
    const after = find(await independent(otherDir), TARGET);
    expect(after?.enabled).toBe(true);
    expect(after?.disabledBy).toBeUndefined();
    await conn.skills.release();
  });

  it('disables at project level for that folder only and re-enables', async () => {
    const conn = await connect();
    await conn.skills.setDisabled(
      { name: PROJECT_SKILL, disabled: true, level: 'project' },
      projectDir,
    );
    expect(find(await independent(projectDir), PROJECT_SKILL)?.disabledBy).toEqual({
      kind: 'ledger',
      levels: ['project'],
    });
    await conn.skills.setDisabled({ name: TARGET, disabled: true, level: 'project' }, projectDir);
    expect(find(await independent(otherDir), TARGET)?.enabled).toBe(true);
    expect(find(await independent(projectDir), TARGET)?.enabled).toBe(false);
    await conn.skills.setDisabled({ name: TARGET, disabled: false, level: 'project' }, projectDir);
    await conn.skills.setDisabled(
      { name: PROJECT_SKILL, disabled: false, level: 'project' },
      projectDir,
    );
    const after = await independent(projectDir);
    expect(find(after, PROJECT_SKILL)?.enabled).toBe(true);
    expect(find(after, TARGET)?.enabled).toBe(true);
    await conn.skills.release();
  });

  it('refuses a project-level change in a folder that cannot hold one', async () => {
    const conn = await connect();
    await expect(
      conn.skills.setDisabled({ name: TARGET, disabled: true, level: 'project' }),
    ).rejects.toThrow();
    await conn.skills.release();
  });
});
