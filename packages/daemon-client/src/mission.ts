/**
 * Mission Control state: a pure model built from SDK 0.9.1 mission snapshots
 * (the `mission` field the daemon returns when a session is resumed) and from
 * the mission notifications (`mission_*` stream events). No React, no I/O.
 */
import { FeatureStatus, ProgressLogEntryType } from '@factory/droid-sdk';
import type { MissionFeature, MissionSnapshot, ProgressLogEntry } from '@factory/droid-sdk';
import type { NormalizedEvent } from './normalize';

/** Wire values of the SDK `MissionState` enum (the app never imports the enum itself). */
export const MISSION_STATES = [
  'planning',
  'awaiting_input',
  'initializing',
  'running',
  'paused',
  'orchestrator_turn',
  'completed',
] as const;
export type MissionStateValue = (typeof MISSION_STATES)[number];

export type MissionWorkerStatus = 'running' | 'completed' | 'failed';

export interface MissionWorker {
  sessionId: string;
  status: MissionWorkerStatus;
  startedAt?: string;
  completedAt?: string;
  /** Present once the worker ended. */
  exitCode?: number;
}

export interface MissionView {
  /** A MissionState wire value, or a newer daemon's value the app does not know yet. */
  state: string;
  title?: string;
  features: MissionFeature[];
  progressLog: ProgressLogEntry[];
  /** Workers in the order they started. */
  workers: MissionWorker[];
  /** Latest heartbeat or progress log timestamp. */
  lastActivity?: string;
}

export interface MissionGroup {
  /** The milestone label; undefined for the bucket of features without one. */
  milestone?: string;
  features: MissionFeature[];
  completed: number;
  total: number;
}

export type MissionEvent = Extract<NormalizedEvent, { type: `mission_${string}` }>;

export function isMissionEvent(event: NormalizedEvent): event is MissionEvent {
  return event.type.startsWith('mission_');
}

export function isKnownMissionState(state: string): state is MissionStateValue {
  return (MISSION_STATES as readonly string[]).includes(state);
}

function workerStatus(exitCode: number | undefined): MissionWorkerStatus {
  if (exitCode === undefined) return 'running';
  return exitCode === 0 ? 'completed' : 'failed';
}

function latest(...timestamps: (string | undefined)[]): string | undefined {
  let best: string | undefined;
  for (const value of timestamps) {
    if (value !== undefined && (best === undefined || Date.parse(value) > Date.parse(best))) {
      best = value;
    }
  }
  return best;
}

function lastLogTimestamp(log: readonly ProgressLogEntry[]): string | undefined {
  return latest(...log.map((entry) => entry.timestamp));
}

/** Workers the progress log knows about, merged over the ones already tracked. */
function workersFromLog(
  log: readonly ProgressLogEntry[],
  known: readonly MissionWorker[],
): MissionWorker[] {
  const byId = new Map(known.map((worker) => [worker.sessionId, worker]));
  const finish = (id: string, timestamp: string, exitCode: number) => {
    const current = byId.get(id);
    byId.set(id, {
      ...current,
      sessionId: id,
      status: workerStatus(exitCode),
      completedAt: timestamp,
      exitCode,
    });
  };
  for (const entry of log) {
    if (entry.type === ProgressLogEntryType.WorkerStarted && !byId.has(entry.workerSessionId)) {
      byId.set(entry.workerSessionId, {
        sessionId: entry.workerSessionId,
        status: 'running',
        startedAt: entry.timestamp,
      });
    } else if (entry.type === ProgressLogEntryType.WorkerCompleted) {
      finish(entry.workerSessionId, entry.timestamp, entry.exitCode);
    } else if (entry.type === ProgressLogEntryType.WorkerFailed && entry.workerSessionId) {
      finish(entry.workerSessionId, entry.timestamp, entry.exitCode ?? 1);
    }
  }
  return [...byId.values()];
}

/** Builds the view a resumed session's `mission` snapshot describes. */
export function missionFromSnapshot(snapshot: MissionSnapshot): MissionView {
  const states = snapshot.workerStates ?? {};
  const ids = new Set([...snapshot.workerSessionIds, ...Object.keys(states)]);
  const fromStates: MissionWorker[] = [...ids].map((sessionId) => {
    const info = states[sessionId];
    return {
      sessionId,
      status: workerStatus(info?.exitCode),
      ...(info?.startedAt ? { startedAt: info.startedAt } : {}),
      ...(info?.completedAt ? { completedAt: info.completedAt } : {}),
      ...(info?.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
    };
  });
  return {
    state: snapshot.state,
    ...(snapshot.title ? { title: snapshot.title } : {}),
    features: [...snapshot.features],
    progressLog: [...snapshot.progressLog],
    workers: workersFromLog(snapshot.progressLog, fromStates),
    lastActivity: latest(snapshot.updatedAt, lastLogTimestamp(snapshot.progressLog)),
  };
}

export const EMPTY_MISSION: MissionView = {
  state: 'planning',
  features: [],
  progressLog: [],
  workers: [],
};

/**
 * Applies one mission notification. Lists are replaced, never appended, so a
 * repeated or replayed notification cannot double rows.
 */
export function applyMissionEvent(
  view: MissionView | undefined,
  event: MissionEvent,
  now: () => string = () => new Date().toISOString(),
): MissionView {
  const current = view ?? EMPTY_MISSION;
  switch (event.type) {
    case 'mission_state_changed':
      return { ...current, state: event.state };
    case 'mission_features_changed':
      return { ...current, features: [...event.features] };
    case 'mission_progress_entry':
      return {
        ...current,
        progressLog: [...event.progressLog],
        workers: workersFromLog(event.progressLog, current.workers),
        lastActivity: latest(current.lastActivity, lastLogTimestamp(event.progressLog)),
      };
    case 'mission_heartbeat':
      return { ...current, lastActivity: latest(current.lastActivity, event.timestamp) };
    case 'mission_worker_started': {
      if (current.workers.some((worker) => worker.sessionId === event.workerSessionId)) {
        return current;
      }
      const worker: MissionWorker = {
        sessionId: event.workerSessionId,
        status: 'running',
        startedAt: now(),
      };
      return { ...current, workers: [...current.workers, worker] };
    }
    case 'mission_worker_completed': {
      const completedAt = now();
      const finished = (worker: MissionWorker): MissionWorker => ({
        ...worker,
        status: workerStatus(event.exitCode),
        completedAt,
        exitCode: event.exitCode,
      });
      const known = current.workers.some((worker) => worker.sessionId === event.workerSessionId);
      return {
        ...current,
        workers: known
          ? current.workers.map((worker) =>
              worker.sessionId === event.workerSessionId ? finished(worker) : worker,
            )
          : [...current.workers, finished({ sessionId: event.workerSessionId, status: 'running' })],
      };
    }
  }
}

/** Features grouped by milestone label (first appearance order); features without one come last. */
export function groupFeatures(features: readonly MissionFeature[]): MissionGroup[] {
  const labelled = new Map<string, MissionFeature[]>();
  const ungrouped: MissionFeature[] = [];
  for (const feature of features) {
    if (feature.milestone) {
      const bucket = labelled.get(feature.milestone);
      if (bucket) bucket.push(feature);
      else labelled.set(feature.milestone, [feature]);
    } else {
      ungrouped.push(feature);
    }
  }
  const summarize = (list: MissionFeature[], milestone?: string): MissionGroup => ({
    ...(milestone !== undefined ? { milestone } : {}),
    features: list,
    completed: list.filter((feature) => feature.status === FeatureStatus.Completed).length,
    total: list.length,
  });
  return [
    ...[...labelled].map(([milestone, list]) => summarize(list, milestone)),
    ...(ungrouped.length > 0 ? [summarize(ungrouped)] : []),
  ];
}

/** True when nothing about the mission has been reported yet. */
export function isMissionIdle(view: MissionView | undefined): boolean {
  return (
    !view ||
    (view.features.length === 0 && view.workers.length === 0 && view.progressLog.length === 0)
  );
}
