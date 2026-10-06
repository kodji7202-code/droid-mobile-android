import { describe, expect, it } from 'vitest';
import {
  MissionFeatureSchema,
  MissionProgressEntryNotificationSchema,
  MissionSnapshotSchema,
  MissionStateChangedNotificationSchema,
  MissionWorkerCompletedNotificationSchema,
  MissionWorkerStartedNotificationSchema,
} from './mission-schemas';
import {
  EMPTY_MISSION,
  MISSION_STATES,
  applyMissionEvent,
  groupFeatures,
  isKnownMissionState,
  isMissionEvent,
  isMissionIdle,
  missionFromSnapshot,
} from './mission';
import type { MissionEvent } from './mission';
import { normalizeStreamEvent } from './normalize';
import type { DroidStreamEvent } from '@factory/droid-sdk';

const feature = (id: string, status: string, milestone?: string) =>
  MissionFeatureSchema.parse({
    id,
    description: id,
    status,
    skillName: 's',
    preconditions: [],
    expectedBehavior: [],
    ...(milestone ? { milestone } : {}),
  });

const event = (notification: object): MissionEvent => {
  const normalized = normalizeStreamEvent(notification as DroidStreamEvent);
  if (!isMissionEvent(normalized)) throw new Error('not a mission event');
  return normalized;
};

const log = (extra: object[] = []) =>
  MissionProgressEntryNotificationSchema.parse({
    type: 'mission_progress_entry',
    progressLog: [
      { type: 'mission_accepted', timestamp: '2026-10-05T10:00:00.000Z', title: 'T' },
      {
        type: 'worker_started',
        timestamp: '2026-10-05T10:01:00.000Z',
        workerSessionId: 'w1',
        spawnId: 'sp1',
      },
      ...extra,
    ],
  });

describe('missionFromSnapshot', () => {
  it('maps state, title, features, progress log, workers and last activity', () => {
    const snapshot = MissionSnapshotSchema.parse({
      state: 'running',
      title: 'Mission',
      updatedAt: '2026-10-05T10:05:00.000Z',
      features: [feature('f1', 'pending')],
      progressLog: [],
      workerSessionIds: ['w1', 'w2'],
      workerStates: {
        w1: { startedAt: '2026-10-05T10:01:00.000Z' },
        w2: {
          startedAt: '2026-10-05T10:02:00.000Z',
          completedAt: '2026-10-05T10:03:00.000Z',
          exitCode: 2,
        },
      },
    });
    const view = missionFromSnapshot(snapshot);
    expect(view.state).toBe('running');
    expect(view.title).toBe('Mission');
    expect(view.features.map((f) => f.id)).toEqual(['f1']);
    expect(view.workers).toEqual([
      { sessionId: 'w1', status: 'running', startedAt: '2026-10-05T10:01:00.000Z' },
      {
        sessionId: 'w2',
        status: 'failed',
        startedAt: '2026-10-05T10:02:00.000Z',
        completedAt: '2026-10-05T10:03:00.000Z',
        exitCode: 2,
      },
    ]);
    expect(view.lastActivity).toBe('2026-10-05T10:05:00.000Z');
  });

  it('is idle when nothing was reported', () => {
    const view = missionFromSnapshot(
      MissionSnapshotSchema.parse({
        state: 'awaiting_input',
        features: [],
        progressLog: [],
        workerSessionIds: [],
      }),
    );
    expect(isMissionIdle(view)).toBe(true);
    expect(isMissionIdle(undefined)).toBe(true);
  });
});

describe('applyMissionEvent', () => {
  it('replaces the feature list instead of appending', () => {
    const first = applyMissionEvent(
      undefined,
      event({
        type: 'mission_features_changed',
        features: [feature('a', 'pending'), feature('b', 'pending')],
      }),
    );
    const second = applyMissionEvent(
      first,
      event({
        type: 'mission_features_changed',
        features: [feature('a', 'completed'), feature('b', 'pending')],
      }),
    );
    expect(second.features.map((f) => [f.id, f.status])).toEqual([
      ['a', 'completed'],
      ['b', 'pending'],
    ]);
  });

  it('tracks workers from started to completed and failed', () => {
    let view = applyMissionEvent(
      undefined,
      event(
        MissionWorkerStartedNotificationSchema.parse({
          type: 'mission_worker_started',
          workerSessionId: 'w1',
        }),
      ),
      () => 't1',
    );
    view = applyMissionEvent(
      view,
      event({ type: 'mission_worker_started', workerSessionId: 'w2' }),
      () => 't2',
    );
    expect(view.workers.map((w) => [w.sessionId, w.status])).toEqual([
      ['w1', 'running'],
      ['w2', 'running'],
    ]);
    view = applyMissionEvent(
      view,
      event(
        MissionWorkerCompletedNotificationSchema.parse({
          type: 'mission_worker_completed',
          workerSessionId: 'w1',
          exitCode: 0,
        }),
      ),
      () => 't3',
    );
    view = applyMissionEvent(
      view,
      event({ type: 'mission_worker_completed', workerSessionId: 'w2', exitCode: 3 }),
      () => 't4',
    );
    expect(view.workers).toEqual([
      { sessionId: 'w1', status: 'completed', startedAt: 't1', completedAt: 't3', exitCode: 0 },
      { sessionId: 'w2', status: 'failed', startedAt: 't2', completedAt: 't4', exitCode: 3 },
    ]);
  });

  it('does not duplicate a worker that starts twice', () => {
    const started = event({ type: 'mission_worker_started', workerSessionId: 'w1' });
    const view = applyMissionEvent(applyMissionEvent(undefined, started), started);
    expect(view.workers).toHaveLength(1);
  });

  it('keeps progress log entries in array order and derives workers from them', () => {
    const view = applyMissionEvent(
      undefined,
      event(
        log([
          {
            type: 'worker_failed',
            timestamp: '2026-10-05T10:02:00.000Z',
            reason: 'crashed',
            spawnId: 'sp1',
            workerSessionId: 'w1',
            exitCode: 9,
          },
        ]),
      ),
    );
    expect(view.progressLog.map((entry) => entry.type)).toEqual([
      'mission_accepted',
      'worker_started',
      'worker_failed',
    ]);
    expect(view.workers).toEqual([
      {
        sessionId: 'w1',
        status: 'failed',
        startedAt: '2026-10-05T10:01:00.000Z',
        completedAt: '2026-10-05T10:02:00.000Z',
        exitCode: 9,
      },
    ]);
    expect(view.lastActivity).toBe('2026-10-05T10:02:00.000Z');
  });

  it('updates last activity on a heartbeat without adding any row', () => {
    const before = applyMissionEvent(undefined, event(log()));
    const after = applyMissionEvent(
      before,
      event({ type: 'mission_heartbeat', timestamp: '2026-10-05T11:00:00.000Z' }),
    );
    expect(after.lastActivity).toBe('2026-10-05T11:00:00.000Z');
    expect(after.progressLog).toEqual(before.progressLog);
    expect(after.workers).toEqual(before.workers);
    expect(after.features).toEqual(before.features);
  });

  it('never moves last activity backwards', () => {
    const view = applyMissionEvent(
      { ...EMPTY_MISSION, lastActivity: '2026-10-05T12:00:00.000Z' },
      event({ type: 'mission_heartbeat', timestamp: '2026-10-05T11:00:00.000Z' }),
    );
    expect(view.lastActivity).toBe('2026-10-05T12:00:00.000Z');
  });

  it('keeps an unknown future state instead of throwing', () => {
    const view = applyMissionEvent(
      undefined,
      event({ type: 'mission_state_changed', state: 'teleporting' }),
    );
    expect(view.state).toBe('teleporting');
    expect(isKnownMissionState(view.state)).toBe(false);
  });

  it('maps every MissionState wire value', () => {
    for (const state of MISSION_STATES) {
      const parsed = MissionStateChangedNotificationSchema.parse({
        type: 'mission_state_changed',
        state,
      });
      expect(applyMissionEvent(undefined, event(parsed)).state).toBe(state);
    }
  });
});

describe('groupFeatures', () => {
  it('groups by milestone in first-seen order and counts completed features', () => {
    const groups = groupFeatures([
      feature('a1', 'completed', 'm1'),
      feature('b1', 'completed', 'm2'),
      feature('b2', 'completed', 'm2'),
      feature('b3', 'in_progress', 'm2'),
      feature('b4', 'pending', 'm2'),
      feature('c1', 'pending', 'm3'),
      feature('x', 'pending'),
    ]);
    expect(groups.map((g) => [g.milestone, g.completed, g.total])).toEqual([
      ['m1', 1, 1],
      ['m2', 2, 4],
      ['m3', 0, 1],
      [undefined, 0, 1],
    ]);
    expect(groups[1]?.features.map((f) => f.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
  });

  it('returns no groups for no features', () => {
    expect(groupFeatures([])).toEqual([]);
  });
});
