import type { DaemonConnection } from '@droidmobile/daemon-client';

export type DaemonSessionSummary = Awaited<ReturnType<DaemonConnection['listSessions']>>[number];

/** sessions.list accepts at most 100 per request; a smaller page keeps the first paint fast. */
export const PAGE_SIZE = 25;

export interface SessionRowData {
  id: string;
  title: string;
  messageCount: number;
  modifiedMs: number;
  cwd?: string;
}

export function toRow(summary: DaemonSessionSummary): SessionRowData {
  return {
    id: summary.id,
    title: summary.title?.trim() ?? '',
    messageCount: summary.messageCount,
    modifiedMs: summary.modifiedTime.getTime(),
    cwd: summary.cwd,
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

/**
 * The daemon's `endBefore` is an exclusive unix-second bound (verified against
 * daemon 0.232.0). Using last+1 keeps rows that share the boundary second but
 * did not fit the page; merging by id removes the repeats. When that cursor
 * would not move (a whole page inside one second) it falls back to the
 * exclusive bound so paging always terminates.
 */
export function nextEndBefore(
  page: SessionRowData[],
  previous: number | undefined,
): number | undefined {
  if (page.length === 0) {
    return undefined;
  }
  const oldest = Math.min(...page.map((row) => row.modifiedMs));
  const lastSecond = Math.floor(oldest / 1000);
  const inclusive = lastSecond + 1;
  return previous !== undefined && inclusive >= previous ? lastSecond : inclusive;
}

export function filterRows(rows: SessionRowData[], query: string): SessionRowData[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return rows;
  }
  return rows.filter(
    (row) =>
      row.title.toLowerCase().includes(needle) || (row.cwd ?? '').toLowerCase().includes(needle),
  );
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
