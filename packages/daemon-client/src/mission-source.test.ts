import { describe, expect, it, vi } from 'vitest';
import { MissionFeatureSchema, MissionSnapshotSchema } from './mission-schemas';
import { createMissionSource } from './mission-source';
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
