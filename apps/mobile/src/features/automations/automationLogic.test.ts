import { describe, expect, it } from 'vitest';
import type { AutomationRun } from '@droidmobile/daemon-client';
import {
  formatDuration,
  runBadge,
  scheduleLabel,
  sortRunsNewestFirst,
  statusBadge,
} from './automationLogic';

describe('statusBadge', () => {
  it.each([
    ['active', 'automations.status.active', 'success'],
    ['paused', 'automations.status.paused', 'muted'],
    ['invalid', 'automations.status.invalid', 'danger'],
  ])('maps %s to a localised label and tone', (status, labelKey, tone) => {
    expect(statusBadge(status)).toEqual({ labelKey, tone });
  });

  it('shows an unknown status as a neutral badge with the raw text', () => {
    expect(statusBadge('archived')).toEqual({ labelKey: null, label: 'archived', tone: 'neutral' });
  });

  it('does not treat inherited object keys as known statuses', () => {
    expect(statusBadge('toString')).toEqual({ labelKey: null, label: 'toString', tone: 'neutral' });
  });
});

describe('runBadge', () => {
  it.each([
    ['succeeded', 'automations.runStatus.succeeded', 'success'],
    ['success', 'automations.runStatus.succeeded', 'success'],
    ['failed', 'automations.runStatus.failed', 'danger'],
    ['running', 'automations.runStatus.running', 'info'],
  ])('maps %s', (status, labelKey, tone) => {
    expect(runBadge(status)).toEqual({ labelKey, tone });
  });

  it('keeps the raw text of an unknown run status', () => {
    expect(runBadge('skipped')).toEqual({ labelKey: null, label: 'skipped', tone: 'neutral' });
  });
});

describe('scheduleLabel', () => {
  it('maps the named schedules to localised labels', () => {
    expect(scheduleLabel('daily')).toEqual({
      kind: 'named',
      labelKey: 'automations.schedule.daily',
    });
    expect(scheduleLabel('weekly')).toEqual({
      kind: 'named',
      labelKey: 'automations.schedule.weekly',
    });
    expect(scheduleLabel('monthly')).toEqual({
      kind: 'named',
      labelKey: 'automations.schedule.monthly',
    });
  });

  it('treats anything else as a cron expression shown as written', () => {
    expect(scheduleLabel('0 9 * * 1')).toEqual({ kind: 'cron', expression: '0 9 * * 1' });
  });

  it('reports a missing or blank schedule as none', () => {
    expect(scheduleLabel(undefined)).toEqual({ kind: 'none' });
    expect(scheduleLabel('  ')).toEqual({ kind: 'none' });
  });
});

describe('sortRunsNewestFirst', () => {
  const run = (runId: string, startedAt: string): AutomationRun => ({
    runId,
    status: 'succeeded',
    startedAt,
  });

  it('orders by startedAt descending regardless of input order and does not mutate', () => {
    const input = [
      run('b', '2026-10-02T09:00:00Z'),
      run('e', '2026-10-05T09:00:00Z'),
      run('a', '2026-10-01T09:00:00Z'),
      run('d', '2026-10-04T09:00:00Z'),
      run('c', '2026-10-03T09:00:00Z'),
    ];
    const snapshot = input.map((item) => item.runId);
    expect(sortRunsNewestFirst(input).map((item) => item.runId)).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(input.map((item) => item.runId)).toEqual(snapshot);
  });

  it('compares instants, not strings, across time zone offsets', () => {
    const sorted = sortRunsNewestFirst([
      run('early', '2026-10-05T10:00:00+05:00'),
      run('late', '2026-10-05T08:00:00Z'),
    ]);
    expect(sorted.map((item) => item.runId)).toEqual(['late', 'early']);
  });

  it('puts runs with an unreadable start time last', () => {
    const sorted = sortRunsNewestFirst([
      run('bad', 'not a date'),
      run('ok', '2026-10-05T09:00:00Z'),
    ]);
    expect(sorted.map((item) => item.runId)).toEqual(['ok', 'bad']);
  });
});

describe('formatDuration', () => {
  it('formats sub-minute, minute and hour durations', () => {
    expect(formatDuration(800, 'en')).toBe('0.8 sec');
    expect(formatDuration(12_000, 'en')).toBe('12 sec');
    expect(formatDuration(125_000, 'en')).toBe('2 min 5 sec');
    expect(formatDuration(3_725_000, 'en')).toBe('1 hr 2 min');
  });

  it('returns undefined for a missing or invalid duration', () => {
    expect(formatDuration(undefined, 'en')).toBeUndefined();
    expect(formatDuration(-5, 'en')).toBeUndefined();
    expect(formatDuration(Number.NaN, 'en')).toBeUndefined();
  });
});
