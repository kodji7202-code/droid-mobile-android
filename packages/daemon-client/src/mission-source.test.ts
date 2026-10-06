import { describe, expect, it, vi } from 'vitest';
import {
  MissionFeatureSchema,
  MissionHeartbeatNotificationSchema,
  MissionSnapshotSchema,
  MissionStateChangedNotificationSchema,
} from './mission-schemas';
import { createMissionSource } from './mission-source';
import { missionFromSnapshot } from './mission';
import { missionPermission } from './interactions';
import type { PermissionRequest } from './interactions';

interface Config {
  getMissionStore?: (id: string) => {
    setState(state: string): void;
    setFeatures(features: unknown[]): void;
  } | null;
  getMissionStoreIfKnown?: (id: string) => unknown;
}

function facade(): { droid: { controller: { config: Config } }; config: Config } {
  const config: Config = {};
  return { droid: { controller: { config } }, config };
}

describe('createMissionSource', () => {
  it('installs injectable stores on the facade controller', () => {
    const source = createMissionSource();
    const { droid, config } = facade();
    expect(source.attach(droid)).toBe(true);
    expect(typeof config.getMissionStore).toBe('function');
    expect(typeof config.getMissionStoreIfKnown).toBe('function');
  });

  it('reports false for a facade without a controller config', () => {
    expect(createMissionSource().attach({})).toBe(false);
    expect(createMissionSource().attach(null)).toBe(false);
  });

  it('has no snapshot and never calls listeners for a session without a mission', () => {
    const source = createMissionSource();
    source.attach(facade().droid);
    const listener = vi.fn();
    const stop = source.subscribe('s1', listener);
    expect(source.snapshot('s1')).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('delivers the snapshot when the store appears and on later changes', () => {
    const source = createMissionSource();
    const { droid, config } = facade();
    source.attach(droid);
    const seen: string[] = [];
    const stop = source.subscribe('s1', (snapshot) => seen.push(snapshot.state));

    // A notification for the session creates its store, as the controller does.
    const store = config.getMissionStore?.('s1');
    store?.setState('running');
    store?.setState('paused');
    expect(seen.at(-1)).toBe('paused');
    expect(source.snapshot('s1')?.state).toBe('paused');

    store?.setFeatures([
      MissionFeatureSchema.parse({
        id: 'f',
        description: 'd',
        status: 'pending',
        skillName: 's',
        preconditions: [],
        expectedBehavior: [],
      }),
    ]);
    expect(source.snapshot('s1')?.features.map((f) => f.id)).toEqual(['f']);

    stop();
    const count = seen.length;
    store?.setState('completed');
    expect(seen).toHaveLength(count);
  });

  it('keeps the snapshot of a mission across a second facade', () => {
    const source = createMissionSource();
    const first = facade();
    source.attach(first.droid);
    first.config.getMissionStore?.('s1')?.setState('running');
    const second = facade();
    source.attach(second.droid);
    expect(source.snapshot('s1')?.state).toBe('running');
    MissionSnapshotSchema.parse(source.snapshot('s1'));
  });
});

type ControllerListener = (event: { sessionId: string; notification: unknown }) => void;

/** The controller as the SDK exposes it: it emits every session notification, heartbeats included. */
function emittingFacade() {
  const config: Config = {};
  const listeners = new Set<ControllerListener>();
  const controller = {
    config,
    on(event: string, listener: ControllerListener) {
      if (event === 'sessionNotification') listeners.add(listener);
    },
    off(event: string, listener: ControllerListener) {
      if (event === 'sessionNotification') listeners.delete(listener);
    },
  };
  return {
    droid: { controller },
    config,
    listenerCount: () => listeners.size,
    emit: (sessionId: string, notification: unknown) => {
      for (const listener of [...listeners]) listener({ sessionId, notification });
    },
  };
}

const heartbeat = (timestamp: string) =>
  MissionHeartbeatNotificationSchema.parse({ type: 'mission_heartbeat', timestamp });
const stateChanged = (state: string) =>
  MissionStateChangedNotificationSchema.parse({ type: 'mission_state_changed', state });

describe('mission heartbeats through the controller bridge', () => {
  const T1 = '2026-10-05T10:00:00.000Z';
  const T2 = '2026-10-05T10:05:00.000Z';

  it('delivers a heartbeat outside any prompt stream to subscribers', () => {
    const source = createMissionSource();
    const facade = emittingFacade();
    source.attach(facade.droid);
    facade.config.getMissionStore?.('s1')?.setState('running');
    const seen: (string | undefined)[] = [];
    const stop = source.subscribe('s1', (snapshot) => {
      seen.push(missionFromSnapshot(snapshot).lastActivity);
    });
    seen.length = 0;

    facade.emit('s1', heartbeat(T1));
    expect(seen).toEqual([T1]);
    stop();
  });

  it('keeps the heartbeat across later snapshot updates', () => {
    const source = createMissionSource();
    const facade = emittingFacade();
    source.attach(facade.droid);
    const store = facade.config.getMissionStore?.('s1');
    store?.setState('running');
    const seen: (string | undefined)[] = [];
    const stop = source.subscribe('s1', (snapshot) => {
      seen.push(missionFromSnapshot(snapshot).lastActivity);
    });

    facade.emit('s1', heartbeat(T1));
    store?.setState('paused');
    store?.setFeatures([]);
    expect(seen.at(-1)).toBe(T1);
    expect(seen.every((activity, index) => index === 0 || activity === T1)).toBe(true);
    stop();
  });

  it('keeps the heartbeat for a remounted subscription and for the first snapshot', () => {
    const source = createMissionSource();
    const facade = emittingFacade();
    source.attach(facade.droid);
    facade.config.getMissionStore?.('s1')?.setState('running');
    const first = source.subscribe('s1', () => undefined);
    facade.emit('s1', heartbeat(T1));
    first();

    expect(missionFromSnapshot(source.snapshot('s1')!).lastActivity).toBe(T1);
    const seen: (string | undefined)[] = [];
    const second = source.subscribe('s1', (snapshot) => {
      seen.push(missionFromSnapshot(snapshot).lastActivity);
    });
    expect(seen).toEqual([T1]);
    second();
  });

  it('never moves last activity backwards and ignores malformed timestamps', () => {
    const source = createMissionSource();
    const facade = emittingFacade();
    source.attach(facade.droid);
    facade.config.getMissionStore?.('s1')?.setState('running');

    facade.emit('s1', heartbeat(T2));
    facade.emit('s1', heartbeat(T1));
    facade.emit('s1', heartbeat('not a date'));
    expect(missionFromSnapshot(source.snapshot('s1')!).lastActivity).toBe(T2);
  });

  it('keeps a heartbeat that arrives before the mission store exists', () => {
    const source = createMissionSource();
    const facade = emittingFacade();
    source.attach(facade.droid);
    const seen: (string | undefined)[] = [];
    const stop = source.subscribe('s1', (snapshot) => {
      seen.push(missionFromSnapshot(snapshot).lastActivity);
    });

    facade.emit('s1', heartbeat(T1));
    expect(seen).toEqual([]);
    facade.config.getMissionStore?.('s1')?.setState('running');
    expect(seen.at(-1)).toBe(T1);
    stop();
  });

  it('scopes heartbeats to their session and survives a second facade', () => {
    const source = createMissionSource();
    const first = emittingFacade();
    source.attach(first.droid);
    first.config.getMissionStore?.('s1')?.setState('running');
    first.config.getMissionStore?.('s2')?.setState('running');
    first.emit('s1', heartbeat(T1));
    const second = emittingFacade();
    source.attach(second.droid);

    expect(missionFromSnapshot(source.snapshot('s1')!).lastActivity).toBe(T1);
    expect(missionFromSnapshot(source.snapshot('s2')!).lastActivity).toBeUndefined();
    second.emit('s2', heartbeat(T2));
    expect(missionFromSnapshot(source.snapshot('s2')!).lastActivity).toBe(T2);
  });

  it('ignores other notifications and snapshots stay SDK-valid', () => {
    const source = createMissionSource();
    const facade = emittingFacade();
    source.attach(facade.droid);
    facade.config.getMissionStore?.('s1')?.setState('running');
    facade.emit('s1', stateChanged('paused'));
    facade.emit('s1', heartbeat(T1));
    const snapshot = source.snapshot('s1');
    MissionSnapshotSchema.parse(snapshot);
    expect(snapshot?.state).toBe('running');
  });
});

describe('missionPermission', () => {
  const requestOf = (details: object) =>
    ({
      options: [],
      toolUses: [{ toolUse: { id: 't', name: 'x', input: {} }, details }],
    }) as unknown as PermissionRequest;

  it('reads a propose_mission request', () => {
    expect(
      missionPermission(requestOf({ type: 'propose_mission', proposal: 'Plan', title: 'T' })),
    ).toEqual({ kind: 'propose_mission', proposal: 'Plan', title: 'T' });
  });

  it('reads a start_mission_run request', () => {
    expect(
      missionPermission(
        requestOf({
          type: 'start_mission_run',
          runningMissionCount: 2,
          runningMissionSessionIds: ['a', 'b'],
        }),
      ),
    ).toEqual({
      kind: 'start_mission_run',
      runningMissionCount: 2,
      runningMissionSessionIds: ['a', 'b'],
    });
  });

  it('ignores every other request', () => {
    expect(missionPermission(requestOf({ type: 'exec' }))).toBeUndefined();
  });
});
