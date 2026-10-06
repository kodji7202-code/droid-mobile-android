import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonConnection, Skill, SkillLevel } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../../stores/connection';
import { useSessionViewStore } from '../../../stores/sessionView';
import { useLinkLoss } from '../useLinkLoss';
import { disabledLevels } from './skillLogic';

export type SkillsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; skills: Skill[]; projectAvailable: boolean };

export interface SkillActionError {
  action: 'disable' | 'enable';
  name: string;
}

/**
 * Folder whose project-level skills apply: the working directory of the session
 * the user has open, or undefined when none is open (user level only).
 */
export function useProjectFolder(): string | undefined {
  return useSessionViewStore((state) => {
    const id = state.activeSessionId;
    const view = id ? state.views[id] : undefined;
    return view?.cwd ?? view?.handle?.cwd ?? undefined;
  });
}

/**
 * The daemon's skill list for the project folder plus its mutations. Every
 * change is followed by a re-read, so rows show what the daemon reports, never
 * an optimistic guess.
 */
export function useSkills(connection: DaemonConnection | null, cwd: string | undefined) {
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const [state, setState] = useState<SkillsState>({ status: 'loading' });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<SkillActionError | null>(null);
  const latest = useRef(0);

  const read = useCallback(
    async (showLoading: boolean) => {
      const ticket = ++latest.current;
      if (!connection) {
        setState({ status: 'error' });
        return;
      }
      if (showLoading) setState({ status: 'loading' });
      try {
        const result = await connection.skills.list(cwd);
        if (ticket === latest.current) setState({ status: 'ready', ...result });
      } catch {
        if (ticket === latest.current && showLoading) setState({ status: 'error' });
      }
    },
    [connection, cwd],
  );

  useLinkLoss(() => {
    latest.current += 1;
    setState({ status: 'error' });
  });

  useEffect(() => {
    void read(true);
    return () => {
      latest.current += 1;
    };
  }, [read, readyEpoch]);

  const track = useCallback(
    async (name: string, action: SkillActionError['action'], op: () => Promise<void>) => {
      if (!connection) return;
      setError(null);
      setBusy((previous) => new Set(previous).add(name));
      try {
        await op();
      } catch {
        setError({ action, name });
      } finally {
        setBusy((previous) => {
          const next = new Set(previous);
          next.delete(name);
          return next;
        });
        await read(false);
      }
    },
    [connection, read],
  );

  const disable = useCallback(
    (skill: Skill, level: SkillLevel) =>
      track(skill.name, 'disable', () =>
        connection!.skills.setDisabled({ name: skill.name, disabled: true, level }, cwd),
      ),
    [connection, cwd, track],
  );

  const enable = useCallback(
    (skill: Skill) =>
      track(skill.name, 'enable', async () => {
        for (const level of disabledLevels(skill)) {
          await connection!.skills.setDisabled({ name: skill.name, disabled: false, level }, cwd);
        }
      }),
    [connection, cwd, track],
  );

  return {
    state,
    busy,
    error,
    clearError: () => setError(null),
    retry: () => void read(true),
    disable,
    enable,
  };
}
