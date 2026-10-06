/**
 * Skill discovery and enablement over the SDK facade (`droid.skills`). The
 * daemon scopes skills to the cwd of an open session (project level) plus
 * `~/.factory` (user level), and a long-lived session can report stale
 * state. The client therefore owns one scratch session for the folder it is
 * asked about (home when none): created on first use, replaced when the
 * folder or the socket changes, closed by release().
 */
import type {
  ConnectedDroid,
  ConnectedDroidSession,
  SettingsLevel,
  SkillInfo,
} from '@factory/droid-sdk';
import { DaemonClientError } from './errors';

/** Levels the daemon accepts for a disable/enable; the string equals the enum value. */
export type SkillLevel = 'user' | 'project';

export interface Skill {
  name: string;
  description?: string;
  /** Reported origin; one of builtin|personal|project|automation today. */
  location: string;
  /** `builtin:<name>` for built-ins, the SKILL.md path otherwise. */
  filePath: string;
  enabled: boolean;
  disabledBy?: { kind: 'ledger'; levels: string[] } | { kind: 'frontmatter' };
}

export interface SkillList {
  skills: Skill[];
  /** True when the session's folder can hold a project-level setting. */
  projectAvailable: boolean;
}

export interface SetSkillDisabledInput {
  name: string;
  disabled: boolean;
  level: SkillLevel;
}

export interface SkillsClient {
  /** Skills as the daemon reports them for `cwd` (home when omitted). */
  list(cwd?: string): Promise<SkillList>;
  /** Sets the skill's state at one level; `cwd` selects the project for level "project". */
  setDisabled(input: SetSkillDisabledInput, cwd?: string): Promise<void>;
  /** Closes the scratch session; the next call opens a new one. */
  release(): Promise<void>;
}

export function toSkill(info: Readonly<SkillInfo>): Skill {
  const reason = info.disabledBy;
  const disabledBy: Skill['disabledBy'] =
    reason?.kind === 'ledger'
      ? { kind: 'ledger', levels: reason.sources.map((source) => source.level) }
      : reason?.kind === 'frontmatter'
        ? { kind: 'frontmatter' }
        : undefined;
  return {
    name: info.name,
    ...(info.description !== undefined ? { description: info.description } : {}),
    location: info.location,
    filePath: info.filePath,
    enabled: info.enabled ?? disabledBy === undefined,
    ...(disabledBy ? { disabledBy } : {}),
  };
}

export interface SkillsClientDeps {
  droid(): ConnectedDroid;
  /** Identity of the current facade; a different value means the socket was replaced. */
  generation(): number;
  /** Runs a facade call, converting SDK failures into classified errors. */
  run<T>(op: () => Promise<T>): Promise<T>;
}

interface ScratchSession {
  id: string;
  generation: number;
  session: ConnectedDroidSession;
}

interface ScratchEntry {
  cwd: string | undefined;
  opening: Promise<ScratchSession>;
}

export function createSkillsClient(deps: SkillsClientDeps): SkillsClient {
  let scratch: ScratchEntry | null = null;

  async function openScratch(cwd: string | undefined): Promise<ScratchSession> {
    const droid = deps.droid();
    const generation = deps.generation();
    let folder = cwd;
    if (folder === undefined) {
      const home = await droid.workspace.validateDirectory('~');
      if (!home.isValid || !home.resolvedPath) {
        throw new DaemonClientError('unknown', home.error ?? 'The daemon has no home folder.');
      }
      folder = home.resolvedPath;
    }
    const session = await droid.sessions.create({ cwd: folder });
    return { id: session.id, generation, session };
  }

  async function closeEntry(entry: ScratchEntry): Promise<void> {
    const known = await entry.opening.catch(() => null);
    if (!known || known.generation !== deps.generation()) return;
    await known.session.close().catch(() => undefined);
  }

  function sessionId(cwd: string | undefined): Promise<string> {
    return deps.run(async () => {
      let current = scratch;
      if (current) {
        const known = await current.opening.catch(() => null);
        if (current.cwd !== cwd) {
          scratch = null;
          void closeEntry(current);
          current = null;
        } else if (!known || known.generation !== deps.generation()) {
          scratch = null;
          current = null;
        }
      }
      if (!current) {
        const entry: ScratchEntry = { cwd, opening: openScratch(cwd) };
        current = entry;
        scratch = entry;
        entry.opening.catch(() => {
          if (scratch === entry) scratch = null;
        });
      }
      return (await current.opening).id;
    });
  }

  async function withSession<T>(
    cwd: string | undefined,
    op: (id: string, skills: ConnectedDroid['skills']) => Promise<T>,
  ): Promise<T> {
    const id = await sessionId(cwd);
    return deps.run(() => op(id, deps.droid().skills));
  }

  return {
    list: (cwd) =>
      withSession(cwd, async (id, skills) => {
        const result = await skills.list(id);
        return {
          skills: result.skills.map(toSkill),
          projectAvailable: result.projectAvailable === true,
        };
      }),
    setDisabled: ({ name, disabled, level }, cwd) =>
      withSession(cwd, async (id, skills) => {
        const result = await skills.setDisabled({
          sessionId: id,
          skillName: name,
          disabled,
          settingsLevel: level as SettingsLevel.User | SettingsLevel.Project,
        });
        if (!result.success) {
          throw new DaemonClientError('unknown', 'The daemon did not change the skill.');
        }
      }),
    async release() {
      const current = scratch;
      scratch = null;
      if (current) await closeEntry(current);
    },
  };
}
