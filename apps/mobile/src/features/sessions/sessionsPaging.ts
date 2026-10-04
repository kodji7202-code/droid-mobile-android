import type { DaemonConnection } from '@droidmobile/daemon-client';

export type DaemonSessionSummary = Awaited<ReturnType<DaemonConnection['listSessions']>>[number];
export type DaemonSearchSummary = Awaited<
  ReturnType<DaemonConnection['searchSessions']>
>['sessions'][number];

/** sessions.list accepts at most 100 per request; a smaller page keeps the first paint fast. */
export const PAGE_SIZE = 25;

export interface SessionRowData {
  id: string;
  title: string;
  /** Absent for search hits: sessions.search does not report a message count. */
  messageCount?: number;
  modifiedMs: number;
  cwd?: string;
  archived?: boolean;
}

export function toRow(summary: DaemonSessionSummary): SessionRowData {
  return {
    id: summary.id,
    title: summary.title?.trim() ?? '',
    messageCount: summary.messageCount,
    modifiedMs: summary.modifiedTime.getTime(),
    cwd: summary.cwd,
    archived: summary.archivedTime != null,
  };
}

export function toSearchRow(hit: DaemonSearchSummary): SessionRowData {
  return {
    id: hit.id,
    title: hit.title?.trim() ?? '',
    modifiedMs: hit.modifiedTime?.getTime() ?? 0,
  };
}

/** Appends rows not yet present, keeping the daemon's newest-first order and dropping duplicates. */
export function mergeRows(
  existing: SessionRowData[],
  incoming: SessionRowData[],
): SessionRowData[] {
  const seen = new Set(existing.map((row) => row.id));
  const merged = [...existing];
  for (const row of incoming) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

/** Largest page sessions.list accepts. */
export const MAX_PAGE_SIZE = 100;

export interface PageCursor {
  /** Exclusive unix-second upper bound for `modifiedTime`. */
  endBefore: number;
  limit: number;
}

/**
 * The daemon's `endBefore` is an exclusive unix-second bound (verified against
 * daemon 0.232.0). Using last+1 keeps rows that share the boundary second but
 * did not fit the page; merging by id removes the repeats. When that cursor
 * would not move (a whole page inside one second) the same bound is requested
 * again with a wider page, so a crowded second is read in full. Only a second
 * holding more than MAX_PAGE_SIZE sessions is stepped over, because the daemon
 * cannot address rows inside one second.
 */
export function nextCursor(
  page: SessionRowData[],
  previous: PageCursor | undefined,
): PageCursor | undefined {
  if (page.length === 0) {
    return undefined;
  }
  const oldest = Math.min(...page.map((row) => row.modifiedMs));
  const lastSecond = Math.floor(oldest / 1000);
  const inclusive = lastSecond + 1;
  if (previous === undefined || inclusive < previous.endBefore) {
    return { endBefore: inclusive, limit: PAGE_SIZE };
  }
  if (previous.limit < MAX_PAGE_SIZE) {
    return {
      endBefore: previous.endBefore,
      limit: Math.min(MAX_PAGE_SIZE, previous.limit * 2),
    };
  }
  return { endBefore: lastSecond, limit: PAGE_SIZE };
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** Localized relative label; under a minute it reads "now" / "acum" via numeric: auto. */
export function formatModified(modifiedMs: number, nowMs: number, language: string): string {
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const elapsedSeconds = Math.max(0, Math.round((nowMs - modifiedMs) / 1000));
  for (const [unit, size] of RELATIVE_STEPS) {
    if (elapsedSeconds >= size) {
      return formatter.format(-Math.floor(elapsedSeconds / size), unit);
    }
  }
  return formatter.format(0, 'second');
}
