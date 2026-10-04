import { describe, expect, it } from 'vitest';
import { filterRows, formatModified, mergeRows, nextEndBefore } from './sessionsPaging';
import type { SessionRowData } from './sessionsPaging';

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

describe('nextEndBefore', () => {
  it('is undefined for an empty page', () => {
    expect(nextEndBefore([], undefined)).toBeUndefined();
  });

  it('uses the oldest second + 1 so same-second siblings are not skipped', () => {
    expect(nextEndBefore([row('a', 5_000), row('b', 3_500)], undefined)).toBe(4);
  });

  it('falls back to the exclusive bound when the cursor would not move', () => {
    expect(nextEndBefore([row('a', 3_200)], 4)).toBe(3);
  });
});

describe('filterRows', () => {
  it('matches title or cwd case-insensitively and returns all for a blank query', () => {
    const rows = [row('a', 1, 'Fix Login'), { ...row('b', 2, 'x'), cwd: 'C:\\Work\\Alpha' }];
    expect(filterRows(rows, '  login ').map((r) => r.id)).toEqual(['a']);
    expect(filterRows(rows, 'alpha').map((r) => r.id)).toEqual(['b']);
    expect(filterRows(rows, '')).toHaveLength(2);
    expect(filterRows(rows, 'zzzz')).toHaveLength(0);
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
