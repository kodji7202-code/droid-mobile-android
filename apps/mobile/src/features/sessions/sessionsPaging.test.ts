import { describe, expect, it } from 'vitest';
import {
  formatModified,
  mergeRows,
  nextCursor,
  PAGE_SIZE,
  toRow,
  toSearchRow,
} from './sessionsPaging';
import type { DaemonSearchSummary, DaemonSessionSummary, SessionRowData } from './sessionsPaging';

const row = (id: string, modifiedMs: number, title = id): SessionRowData => ({
  id,
  title,
  messageCount: 2,
  modifiedMs,
});

describe('mergeRows', () => {
  it('appends new rows and never duplicates an id, keeping order', () => {
    const merged = mergeRows([row('a', 3000), row('b', 2000)], [row('b', 2000), row('c', 1000)]);
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('nextCursor', () => {
  it('is undefined for an empty page', () => {
    expect(nextCursor([], undefined)).toBeUndefined();
  });

  it('uses the oldest second + 1 so same-second siblings are not skipped', () => {
    expect(nextCursor([row('a', 5_000), row('b', 3_500)], undefined)).toEqual({
      endBefore: 4,
      limit: PAGE_SIZE,
    });
  });

  it('widens the page instead of skipping the second when the cursor would not move', () => {
    expect(nextCursor([row('a', 3_200)], { endBefore: 4, limit: PAGE_SIZE })).toEqual({
      endBefore: 4,
      limit: PAGE_SIZE * 2,
    });
  });

  it('caps the widened page at the daemon maximum, then steps past the second', () => {
    expect(nextCursor([row('a', 3_200)], { endBefore: 4, limit: 100 })).toEqual({
      endBefore: 3,
      limit: PAGE_SIZE,
    });
  });
});
describe('row mapping', () => {
  it('marks list rows archived from archivedTime', () => {
    const base = { id: 'a', messageCount: 3, modifiedTime: new Date(5_000) };
    expect(toRow(base as DaemonSessionSummary).archived).toBe(false);
    expect(toRow({ ...base, archivedTime: new Date(6_000) } as DaemonSessionSummary).archived).toBe(
      true,
    );
  });

  it('reads worktree metadata the daemon reports beyond the typed summary', () => {
    const base = { id: 'a', messageCount: 1, modifiedTime: new Date(5_000), cwd: 'C:\\wt\\S' };
    const withWorktree = {
      ...base,
      worktree: { branch: 'main-wt', path: 'C:\\wt\\S', repoRoot: 'C:/S', lifecycle: 'ephemeral' },
    };
    expect(toRow(withWorktree as unknown as DaemonSessionSummary).worktree).toEqual({
      branch: 'main-wt',
      path: 'C:\\wt\\S',
    });
    expect(toRow(base as DaemonSessionSummary).worktree).toBeUndefined();
    const malformed = { ...base, worktree: { branch: 3 } };
    expect(toRow(malformed as unknown as DaemonSessionSummary).worktree).toBeUndefined();
  });

  it('maps a search hit without a message count', () => {
    const hit = { id: 'a', title: ' Fix ', modifiedTime: new Date(5_000), hits: [] };
    expect(toSearchRow(hit as unknown as DaemonSearchSummary)).toEqual({
      id: 'a',
      title: 'Fix',
      modifiedMs: 5_000,
    });
  });
});

describe('formatModified', () => {
  const now = Date.UTC(2026, 9, 4, 12, 0, 0);
  it('says now for under a minute in each language', () => {
    expect(formatModified(now - 4_000, now, 'en')).toBe('now');
    expect(formatModified(now - 4_000, now, 'ro')).toBe('acum');
  });
  it('uses minutes, hours and days', () => {
    expect(formatModified(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago');
    expect(formatModified(now - 3 * 3600_000, now, 'en')).toBe('3 hours ago');
    expect(formatModified(now - 2 * 86400_000, now, 'en')).toBe('2 days ago');
  });
});
