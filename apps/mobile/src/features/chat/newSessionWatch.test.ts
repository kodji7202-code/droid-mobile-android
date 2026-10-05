import { describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { expectedAutonomy, knownSessionIds, waitForNewSession } from './newSessionWatch';

interface Row {
  id: string;
  cwd: string;
  modifiedTime: Date;
  autonomy?: string;
}

const row = (id: string, ageSeconds: number, cwd = 'C:\\work\\proj', autonomy = 'high'): Row => ({
  id,
  cwd,
  modifiedTime: new Date(1_800_000_000_000 - ageSeconds * 1000),
  autonomy,
});

/** Mimics sessions.list: newest first, `endBefore` is an exclusive unix-second bound. */
function fakeConnection(rows: Row[]) {
  const listSessions = vi.fn(async (options?: { limit?: number; endBefore?: number }) => {
    const limit = options?.limit ?? 50;
    const bound = options?.endBefore;
    return rows
      .filter((r) => bound === undefined || r.modifiedTime.getTime() / 1000 < bound)
      .sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
      .slice(0, limit);
  });
  const resumeSession = vi.fn(async (id: string) => ({
    settingsSnapshot: { autonomyLevel: rows.find((r) => r.id === id)?.autonomy },
  }));
  return {
    connection: { listSessions, resumeSession } as unknown as DaemonConnection,
    rows,
    resumeSession,
  };
}

const run = (connection: DaemonConnection, known: Set<string>, autonomy?: string) =>
  waitForNewSession({
    connection,
    known,
    cwd: 'C:\\work\\proj',
    autonomy,
    signal: new AbortController().signal,
    timeoutMs: 50,
    intervalMs: 5,
  });

describe('knownSessionIds', () => {
  it('reads every page, not only the newest 50', async () => {
    const rows = Array.from({ length: 130 }, (_, index) => row(`old-${index}`, 1000 + index * 2));
    const { connection } = fakeConnection(rows);
    const known = await knownSessionIds(connection);
    expect(known.size).toBe(130);
  });

  it('rejects instead of returning a partial set when the history exceeds the paging budget', async () => {
    const rows = Array.from({ length: 130 }, (_, index) => row(`old-${index}`, 1000 + index * 2));
    const { connection } = fakeConnection(rows);
    await expect(knownSessionIds(connection, 1)).rejects.toThrow();
  });

  it('rejects when paging fails', async () => {
    const connection = {
      listSessions: vi.fn(async () => {
        throw new Error('offline');
      }),
    } as unknown as DaemonConnection;
    await expect(knownSessionIds(connection)).rejects.toThrow();
  });
});

describe('waitForNewSession', () => {
  it('never picks an old session beyond the first 50 of the pre-state', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => row(`old-${index}`, 1000 + index * 2));
    const { connection } = fakeConnection(rows);
    const known = await knownSessionIds(connection);
    expect(await run(connection, known, 'high')).toBeUndefined();
  });

  it('opens the new session with the expected autonomy and skips other new ones', async () => {
    const rows = Array.from({ length: 70 }, (_, index) => row(`old-${index}`, 1000 + index * 2));
    const { connection, resumeSession } = fakeConnection(rows);
    const known = await knownSessionIds(connection);
    rows.push(
      row('other', 0, 'C:\\work\\proj', 'low'),
      row('fresh', 1, 'c:\\work\\proj\\', 'high'),
    );
    expect(await run(connection, known, 'high')).toBe('fresh');
    expect(resumeSession).toHaveBeenCalledWith('other');
  });

  it('does not require autonomy for the plain new session option', async () => {
    const { connection, rows } = fakeConnection([row('old', 100)]);
    const known = await knownSessionIds(connection);
    rows.push(row('fresh', 0, 'C:\\work\\proj', 'off'));
    expect(await run(connection, known, undefined)).toBe('fresh');
  });
});

describe('expectedAutonomy', () => {
  it('maps the option value to the autonomy level', () => {
    expect(expectedAutonomy('proceed_new_session_low')).toBe('low');
    expect(expectedAutonomy('proceed_new_session_medium')).toBe('medium');
    expect(expectedAutonomy('proceed_new_session_high')).toBe('high');
    expect(expectedAutonomy('proceed_new_session')).toBeUndefined();
  });
});
