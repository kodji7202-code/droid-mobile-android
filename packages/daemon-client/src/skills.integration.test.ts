/**
 * Integration tests for skill listing and enablement against the REAL daemon on
 * 127.0.0.1:3101. Every change is undone in `afterAll`, and the final
 * disabled-skill set is compared with the recorded pre-state. No model prompt
 * is sent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonConnection } from './connection';
import type { DaemonConnection } from './connection';
import type { Skill } from './skills';

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
  preDisabled = disabledNames(await independent());
});

afterAll(async () => {
  const conn = await connect();
  const current = (await conn.skills.list(projectDir)).skills;
  for (const skill of current) {
    if (skill.enabled || skill.disabledBy?.kind !== 'ledger') continue;
    for (const level of skill.disabledBy.levels) {
      if (level === 'user' || level === 'project') {
        await conn.skills.setDisabled({ name: skill.name, disabled: false, level }, projectDir);
      }
    }
  }
  await conn.skills.release().catch(() => undefined);
  for (const item of open) item.disconnect();
  await rm(projectDir, { recursive: true, force: true });
  await rm(otherDir, { recursive: true, force: true });
  expect(disabledNames(await independent())).toEqual(preDisabled);
});

describe('skills against the real daemon', () => {
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
    await conn.skills.setDisabled({ name: 'tuistory', disabled: true, level: 'user' }, projectDir);
    const other = find(await independent(otherDir), 'tuistory');
    expect(other).toMatchObject({ enabled: false, disabledBy: { kind: 'ledger' } });
    expect(other?.disabledBy).toEqual({ kind: 'ledger', levels: ['user'] });
    await conn.skills.setDisabled({ name: 'tuistory', disabled: false, level: 'user' }, projectDir);
    const after = find(await independent(otherDir), 'tuistory');
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
    await conn.skills.setDisabled(
      { name: 'tuistory', disabled: true, level: 'project' },
      projectDir,
    );
    expect(find(await independent(otherDir), 'tuistory')?.enabled).toBe(true);
    expect(find(await independent(projectDir), 'tuistory')?.enabled).toBe(false);
    await conn.skills.setDisabled(
      { name: 'tuistory', disabled: false, level: 'project' },
      projectDir,
    );
    await conn.skills.setDisabled(
      { name: PROJECT_SKILL, disabled: false, level: 'project' },
      projectDir,
    );
    const after = await independent(projectDir);
    expect(find(after, PROJECT_SKILL)?.enabled).toBe(true);
    expect(find(after, 'tuistory')?.enabled).toBe(true);
    await conn.skills.release();
  });

  it('refuses a project-level change in a folder that cannot hold one', async () => {
    const conn = await connect();
    await expect(
      conn.skills.setDisabled({ name: 'tuistory', disabled: true, level: 'project' }),
    ).rejects.toThrow();
    await conn.skills.release();
  });
});
