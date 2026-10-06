import type { AutomationRun } from '@droidmobile/daemon-client';

export type BadgeTone = 'success' | 'info' | 'danger' | 'neutral' | 'muted';

export type Badge =
  { labelKey: string; tone: BadgeTone } | { labelKey: null; label: string; tone: 'neutral' };

const STATUS_BADGES: Readonly<Record<string, { labelKey: string; tone: BadgeTone }>> = {
  active: { labelKey: 'automations.status.active', tone: 'success' },
  paused: { labelKey: 'automations.status.paused', tone: 'muted' },
  invalid: { labelKey: 'automations.status.invalid', tone: 'danger' },
};

const RUN_BADGES: Readonly<Record<string, { labelKey: string; tone: BadgeTone }>> = {
  succeeded: { labelKey: 'automations.runStatus.succeeded', tone: 'success' },
  success: { labelKey: 'automations.runStatus.succeeded', tone: 'success' },
  failed: { labelKey: 'automations.runStatus.failed', tone: 'danger' },
  running: { labelKey: 'automations.runStatus.running', tone: 'info' },
};

function lookup(
  table: Readonly<Record<string, { labelKey: string; tone: BadgeTone }>>,
  raw: string,
) {
  const known = Object.hasOwn(table, raw) ? table[raw] : undefined;
  return known ?? ({ labelKey: null, label: raw, tone: 'neutral' } as const);
}

/** Badge for the state `automations.list` reports; an unknown value shows its raw text. */
export function statusBadge(status: string): Badge {
  return lookup(STATUS_BADGES, status);
}

/** Badge for a run (or last run) status; an unknown value shows its raw text. */
export function runBadge(status: string): Badge {
  return lookup(RUN_BADGES, status);
}

export type ScheduleLabel =
  { kind: 'named'; labelKey: string } | { kind: 'cron'; expression: string } | { kind: 'none' };

const NAMED_SCHEDULES = new Set(['daily', 'weekly', 'monthly']);

/** The daemon accepts daily, weekly, monthly or a cron expression; the latter is shown as written. */
export function scheduleLabel(schedule: string | undefined): ScheduleLabel {
  const value = schedule?.trim() ?? '';
  if (value === '') return { kind: 'none' };
  return NAMED_SCHEDULES.has(value)
    ? { kind: 'named', labelKey: `automations.schedule.${value}` }
    : { kind: 'cron', expression: value };
}

function startedMs(run: AutomationRun): number {
  const time = Date.parse(run.startedAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Newest first by start instant, whatever order the daemon returned; unreadable times last. */
export function sortRunsNewestFirst(runs: readonly AutomationRun[]): AutomationRun[] {
  return [...runs].sort((a, b) => startedMs(b) - startedMs(a));
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function unit(language: string, unitName: 'second' | 'minute' | 'hour', value: number): string {
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: unitName,
    unitDisplay: 'short',
    maximumFractionDigits: unitName === 'second' && value < 10 ? 1 : 0,
  }).format(value);
}

/** Compact localised duration; undefined when the daemon gave none. */
export function formatDuration(ms: number | undefined, language: string): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < MINUTE) return unit(language, 'second', ms / SECOND);
  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    const seconds = Math.round((ms % MINUTE) / SECOND);
    return seconds === 0
      ? unit(language, 'minute', minutes)
      : `${unit(language, 'minute', minutes)} ${unit(language, 'second', seconds)}`;
  }
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.round((ms % HOUR) / MINUTE);
  return minutes === 0
    ? unit(language, 'hour', hours)
    : `${unit(language, 'hour', hours)} ${unit(language, 'minute', minutes)}`;
}

/** Localised date and time for a daemon timestamp; undefined when it cannot be read. */
export function formatDateTime(iso: string | undefined, language: string): string | undefined {
  if (!iso) return undefined;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return undefined;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    time,
  );
}
