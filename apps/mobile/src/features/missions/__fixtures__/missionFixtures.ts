/**
 * Mission payloads for tests and the dev fixture route. Every payload is parsed
 * with the SDK 0.9.1 schema it claims to follow, so a shape the SDK would reject
 * fails at import time. They are written by hand, not recorded from a real mission.
 */
import {
  MissionFeatureSchema,
  MissionFeaturesChangedNotificationSchema,
  MissionHeartbeatNotificationSchema,
  MissionProgressEntryNotificationSchema,
  MissionSnapshotSchema,
  MissionStateChangedNotificationSchema,
  MissionWorkerCompletedNotificationSchema,
  MissionWorkerStartedNotificationSchema,
  ProposeMissionConfirmationDetailsSchema,
  StartMissionRunConfirmationDetailsSchema,
} from '@droidmobile/daemon-client/mission-schemas';
import { normalizeStreamEvent } from '@droidmobile/daemon-client';
import type {
  MissionEvent,
  MissionView,
  PermissionRequest,
  NormalizedEvent,
} from '@droidmobile/daemon-client';
import { missionFromSnapshot } from '@droidmobile/daemon-client';

type StreamEventInput = Parameters<typeof normalizeStreamEvent>[0];

/** Marker the production bundle must never contain (VAL-MISSION-020). */
export const MISSION_FIXTURE_MARKER = 'droidm-mission-fixture-marker';

type FeatureStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export function feature(
  id: string,
  status: FeatureStatus,
  milestone?: string,
  description = `Feature ${id}`,
) {
  return MissionFeatureSchema.parse({
    id,
    description,
    status,
    skillName: 'frontend-worker',
    preconditions: [],
    expectedBehavior: [`${id} works`],
    ...(milestone ? { milestone } : {}),
  });
}

/** One feature per FeatureStatus, in this order. */
export const statusFeatures = () => [
  feature('f-pending', 'pending', 'm1', 'Pending feature'),
  feature('f-progress', 'in_progress', 'm1', 'In progress feature'),
  feature('f-done', 'completed', 'm1', 'Completed feature'),
  feature('f-cancelled', 'cancelled', 'm1', 'Cancelled feature'),
];

/** m1 (1), m2 (4 features, 2 completed), m3 (1) and one feature without a milestone. */
export const milestoneFeatures = () => [
  feature('a1', 'completed', 'm1'),
  feature('b1', 'completed', 'm2'),
  feature('b2', 'completed', 'm2'),
  feature('b3', 'in_progress', 'm2'),
  feature('b4', 'pending', 'm2'),
  feature('c1', 'pending', 'm3'),
  feature('loose', 'pending'),
];

export const stateChanged = (state: string) =>
  MissionStateChangedNotificationSchema.parse({ type: 'mission_state_changed', state });

export const featuresChanged = (features: ReturnType<typeof feature>[]) =>
  MissionFeaturesChangedNotificationSchema.parse({ type: 'mission_features_changed', features });

export const heartbeat = (timestamp: string) =>
  MissionHeartbeatNotificationSchema.parse({ type: 'mission_heartbeat', timestamp });

export const workerStarted = (workerSessionId: string) =>
  MissionWorkerStartedNotificationSchema.parse({ type: 'mission_worker_started', workerSessionId });

export const workerCompleted = (workerSessionId: string, exitCode: number) =>
  MissionWorkerCompletedNotificationSchema.parse({
    type: 'mission_worker_completed',
    workerSessionId,
    exitCode,
  });

export const PROGRESS_LOG = [
  { type: 'mission_accepted', timestamp: '2026-10-05T10:00:00.000Z', title: 'Build the thing' },
  { type: 'mission_run_started', timestamp: '2026-10-05T10:01:00.000Z' },
  {
    type: 'worker_started',
    timestamp: '2026-10-05T10:02:00.000Z',
    workerSessionId: 'w-1',
    spawnId: 'spawn-1',
    featureId: 'f-progress',
  },
  {
    type: 'worker_selected_feature',
    timestamp: '2026-10-05T10:02:30.000Z',
    workerSessionId: 'w-1',
    featureId: 'f-progress',
  },
  {
    type: 'milestone_validation_triggered',
    timestamp: '2026-10-05T10:09:00.000Z',
    milestone: 'm1',
    featureId: 'f-done',
  },
];

export const progressEntry = (progressLog: unknown[] = PROGRESS_LOG) =>
  MissionProgressEntryNotificationSchema.parse({
    type: 'mission_progress_entry',
    progressLog,
  });

export const snapshot = () =>
  MissionSnapshotSchema.parse({
    state: 'running',
    title: 'Build the thing',
    features: statusFeatures(),
    progressLog: PROGRESS_LOG,
    workerSessionIds: ['w-1', 'w-2'],
    workerStates: {
      'w-1': { startedAt: '2026-10-05T10:02:00.000Z' },
      'w-2': {
        startedAt: '2026-10-05T10:03:00.000Z',
        completedAt: '2026-10-05T10:08:00.000Z',
        exitCode: 0,
      },
    },
  });

export const snapshotView = (): MissionView => missionFromSnapshot(snapshot());

/** Normalizes a parsed notification the way the daemon-client stream does. */
export const asMissionEvent = (notification: object): MissionEvent => {
  const event: NormalizedEvent = normalizeStreamEvent(notification as StreamEventInput);
  if (!event.type.startsWith('mission_')) throw new Error(`not a mission event: ${event.type}`);
  return event as MissionEvent;
};

const request = (toolName: string, details: object): PermissionRequest =>
  ({
    options: [
      { value: 'proceed_once', label: 'Proceed' },
      { value: 'cancel', label: 'Cancel' },
    ],
    toolUses: [
      {
        toolUse: { type: 'tool_use', id: `${toolName}-1`, name: toolName, input: {} },
        details,
        confirmationType: (details as { type: string }).type,
      },
    ],
  }) as unknown as PermissionRequest;

export const proposeMissionRequest = () =>
  request(
    'ProposeMission',
    ProposeMissionConfirmationDetailsSchema.parse({
      type: 'propose_mission',
      proposal: '# Proposal\n\nBuild **three** milestones.',
      title: 'Ship the thing',
    }),
  );

export const startMissionRunRequest = () =>
  request(
    'StartMissionRun',
    StartMissionRunConfirmationDetailsSchema.parse({
      type: 'start_mission_run',
      runningMissionCount: 2,
      runningMissionSessionIds: ['other-1', 'other-2'],
    }),
  );
