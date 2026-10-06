/**
 * Feeds the SDK's `MultiMissionStateManager` from a connected facade.
 *
 * The public facade resumes sessions with the daemon's `mission` snapshot but
 * keeps no mission store of its own: the controller underneath only fills one
 * when its config carries `getMissionStore`. Installing the manager there is
 * what makes snapshots and mission notifications (also the ones that arrive
 * between turns, while workers run) visible to the app.
 */
import { MultiMissionStateManager } from '@factory/droid-sdk';
import type { MissionSnapshot } from '@factory/droid-sdk';

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

function controllerConfig(droid: unknown): ControllerConfig | undefined {
  const config = (droid as { controller?: { config?: unknown } } | null)?.controller?.config;
  return typeof config === 'object' && config !== null ? (config as ControllerConfig) : undefined;
}

export function createMissionSource(): MissionSource {
  let created: MultiMissionStateManager | undefined;
  // Built on first use: a facade without an injectable controller never needs one.
  const getManager = () => (created ??= new MultiMissionStateManager());

  return {
    attach(droid) {
      const config = controllerConfig(droid);
      if (!config) return false;
      const manager = getManager();
      config.getMissionStore = (sessionId) => manager.getMissionStore(sessionId);
      config.getMissionStoreIfKnown = (sessionId) => manager.getMissionStoreIfKnown(sessionId);
      return true;
    },

    snapshot: (sessionId) => created?.getMissionStoreIfKnown(sessionId)?.getSnapshot(),

    subscribe(sessionId, listener) {
      const manager = getManager();
      let store: MissionStore | null = null;
      let unsubscribeStore = () => {};
      const emit = () => {
        if (store) listener(store.getSnapshot());
      };
      const follow = () => {
        const next = manager.getMissionStoreIfKnown(sessionId);
        if (next === store) return;
        unsubscribeStore();
        store = next;
        unsubscribeStore = next ? next.subscribe(emit) : () => {};
        emit();
      };
      const unsubscribeManager = manager.subscribe(follow);
      follow();
      return () => {
        unsubscribeManager();
        unsubscribeStore();
      };
    },
  };
}
