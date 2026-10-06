import { useEffect, useMemo } from 'react';
import { missionFromSnapshot } from '@droidmobile/daemon-client';
import type { MissionView } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';
import { useMissionStore } from '../../stores/missions';

/**
 * The mission state of one session. The daemon's snapshot (what resuming the session
 * returned, kept by the connection) answers the very first render, so re-entering the
 * view never flashes the empty state; later snapshots and notifications replace it
 * through the store.
 */
export function useMissionView(sessionId: string, enabled: boolean): MissionView | undefined {
  const connection = useConnectionStore((state) => state.connection);
  const stored = useMissionStore((state) => state.views[sessionId]);
  const hydrate = useMissionStore((state) => state.hydrate);

  const initial = useMemo(() => {
    if (!enabled || !connection) return undefined;
    const snapshot = connection.missions.snapshot(sessionId);
    return snapshot ? missionFromSnapshot(snapshot) : undefined;
  }, [enabled, connection, sessionId]);

  useEffect(() => {
    if (!enabled || !connection) return;
    return connection.missions.subscribe(sessionId, (snapshot) => hydrate(sessionId, snapshot));
  }, [enabled, connection, sessionId, hydrate]);

  return enabled ? (stored ?? initial) : undefined;
}
