/**
 * Feeds the SDK's `MultiMissionStateManager` from a connected facade.
 *
 * The public facade resumes sessions with the daemon's `mission` snapshot but
 * keeps no mission store of its own: the controller underneath only fills one
 * when its config carries `getMissionStore`. Installing the manager there is
 * what makes snapshots and mission notifications (also the ones that arrive
 * between turns, while workers run) visible to the app. Heartbeats are the one
 * notification the SDK store drops, so they are read off the controller's
 * notification events and merged into the snapshots.
 */
import type { MissionSnapshot, MultiMissionStateManager } from '@factory/droid-sdk';
import { loadedSdk, loadSdk } from './sdk';

type MissionStore = ReturnType<MultiMissionStateManager['getMissionStore']>;

interface ControllerConfig {
  getMissionStore?: (sessionId: string) => MissionStore | null;
  getMissionStoreIfKnown?: (sessionId: string) => MissionStore | null;
}

export interface MissionSource {
  /** Installs the manager on a facade; false when this SDK build has no injectable store. */
  attach(droid: unknown): boolean;
  /** Latest snapshot of the mission a session belongs to, undefined for a session without one. */
  snapshot(sessionId: string): MissionSnapshot | undefined;
  /**
   * Calls `listener` with the snapshot of the session's mission once it exists and
   * again on every change. A session without a mission store never calls it.
   * Returns the unsubscribe.
   */
  subscribe(sessionId: string, listener: (snapshot: MissionSnapshot) => void): () => void;
}

interface SessionNotificationEvent {
  sessionId: string;
  notification: { type?: unknown; timestamp?: unknown };
}

interface NotifyingController {
  on?: (event: 'sessionNotification', listener: (event: SessionNotificationEvent) => void) => void;
}

function controllerOf(droid: unknown): (NotifyingController & { config?: unknown }) | undefined {
  const controller = (droid as { controller?: unknown } | null)?.controller;
  return typeof controller === 'object' && controller !== null ? controller : undefined;
}

function controllerConfig(droid: unknown): ControllerConfig | undefined {
  const config = controllerOf(droid)?.config;
  return typeof config === 'object' && config !== null ? (config as ControllerConfig) : undefined;
}

const isLater = (candidate: string, than: string | undefined) =>
  !Number.isNaN(Date.parse(candidate)) &&
  (than === undefined || Date.parse(candidate) > Date.parse(than));

export function createMissionSource(): MissionSource {
  let created: MultiMissionStateManager | undefined;
  // Built on first use once the SDK is loaded: a facade without an injectable controller never needs one.
  const getManager = (): MultiMissionStateManager | undefined => {
    const sdk = loadedSdk();
    if (!created && sdk) created = new sdk.MultiMissionStateManager();
    return created;
  };
  /**
   * SDK 0.9.1 drops `mission_heartbeat` (the controller ignores it and the store keeps
   * no timestamp), so the latest one per session is kept here and folded into the
   * snapshot's `updatedAt`. It outlives facades and store snapshots.
   */
  const heartbeats = new Map<string, string>();
  const heartbeatListeners = new Set<(sessionId: string) => void>();
  const withHeartbeat = (sessionId: string, snapshot: MissionSnapshot): MissionSnapshot => {
    const beat = heartbeats.get(sessionId);
    return beat !== undefined && isLater(beat, snapshot.updatedAt)
      ? { ...snapshot, updatedAt: beat }
      : snapshot;
  };

  return {
    attach(droid) {
      const config = controllerConfig(droid);
      if (!config) return false;
      const manager = getManager();
      if (!manager) return false;
      config.getMissionStore = (sessionId) => manager.getMissionStore(sessionId);
      config.getMissionStoreIfKnown = (sessionId) => manager.getMissionStoreIfKnown(sessionId);
      controllerOf(droid)?.on?.('sessionNotification', ({ sessionId, notification }) => {
        if (notification.type !== 'mission_heartbeat') return;
        const { timestamp } = notification;
        if (typeof timestamp !== 'string' || !isLater(timestamp, heartbeats.get(sessionId))) return;
        heartbeats.set(sessionId, timestamp);
        for (const notify of heartbeatListeners) notify(sessionId);
      });
      return true;
    },

    snapshot(sessionId) {
      const snapshot = created?.getMissionStoreIfKnown(sessionId)?.getSnapshot();
      return snapshot && withHeartbeat(sessionId, snapshot);
    },

    subscribe(sessionId, listener) {
      const manager = getManager();
      if (manager) return follow(manager, sessionId, listener);
      // Nothing can be known before the SDK is loaded; the subscription starts once it is.
      let cancelled = false;
      let stop = () => {};
      void loadSdk().then(
        () => {
          const loadedManager = getManager();
          if (!cancelled && loadedManager) stop = follow(loadedManager, sessionId, listener);
        },
        () => {},
      );
      return () => {
        cancelled = true;
        stop();
      };
    },
  };

  function follow(
    manager: MultiMissionStateManager,
    sessionId: string,
    listener: (snapshot: MissionSnapshot) => void,
  ): () => void {
    let store: MissionStore | null = null;
    let unsubscribeStore = () => {};
    const emit = () => {
      if (store) listener(withHeartbeat(sessionId, store.getSnapshot()));
    };
    const onHeartbeat = (id: string) => {
      if (id === sessionId) emit();
    };
    heartbeatListeners.add(onHeartbeat);
    const track = () => {
      const next = manager.getMissionStoreIfKnown(sessionId);
      if (next === store) return;
      unsubscribeStore();
      store = next;
      unsubscribeStore = next ? next.subscribe(emit) : () => {};
      emit();
    };
    const unsubscribeManager = manager.subscribe(track);
    track();
    return () => {
      heartbeatListeners.delete(onHeartbeat);
      unsubscribeManager();
      unsubscribeStore();
    };
  }
}
