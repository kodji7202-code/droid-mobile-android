import { create } from 'zustand';
import { applyMissionEvent, missionFromSnapshot } from '@droidmobile/daemon-client';
import type { MissionEvent, MissionSnapshot, MissionView } from '@droidmobile/daemon-client';
import { useConnectionStore } from './connection';

interface MissionStore {
  /** Mission state per session id; a session without an entry has had no mission activity. */
  views: Record<string, MissionView>;
  /** Replaces the session's state with the daemon's snapshot (resume, store change, restart). */
  hydrate(sessionId: string, snapshot: MissionSnapshot): void;
  /** Applies one `mission_*` stream notification. */
  apply(sessionId: string, event: MissionEvent): void;
  reset(): void;
}

export const useMissionStore = create<MissionStore>((set) => ({
  views: {},
  hydrate(sessionId, snapshot) {
    set((state) => ({ views: { ...state.views, [sessionId]: missionFromSnapshot(snapshot) } }));
  },
  apply(sessionId, event) {
    set((state) => ({
      views: { ...state.views, [sessionId]: applyMissionEvent(state.views[sessionId], event) },
    }));
  },
  reset() {
    set({ views: {} });
  },
}));

/** Mission state belongs to the daemon that reported it: another connection starts empty. */
useConnectionStore.subscribe((state, previous) => {
  if (state.connection !== previous.connection) useMissionStore.getState().reset();
});
