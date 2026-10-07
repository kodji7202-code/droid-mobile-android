import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('lazy SDK access', () => {
  it('reports nothing loaded until loadSdk resolves, then the same module every time', async () => {
    const { loadSdk, loadedSdk } = await import('./sdk');
    expect(loadedSdk()).toBeUndefined();
    const first = await loadSdk();
    expect(loadedSdk()).toBe(first);
    expect(await loadSdk()).toBe(first);
    expect(typeof first.connectToDaemon).toBe('function');
  });

  it('starts a mission subscription made before the SDK was loaded once it is', async () => {
    const { loadSdk } = await import('./sdk');
    const { createMissionSource } = await import('./mission-source');
    const source = createMissionSource();
    const seen: string[] = [];
    const stop = source.subscribe('s1', (snapshot) => seen.push(snapshot.state));

    await loadSdk();
    await Promise.resolve();
    const config: {
      getMissionStore?: (id: string) => { setState(state: string): void } | null;
    } = {};
    expect(source.attach({ controller: { config } })).toBe(true);
    config.getMissionStore?.('s1')?.setState('running');
    expect(seen.at(-1)).toBe('running');
    stop();
  });

  it('does not start a deferred subscription that was cancelled first', async () => {
    const { loadSdk } = await import('./sdk');
    const { createMissionSource } = await import('./mission-source');
    const source = createMissionSource();
    const seen: string[] = [];
    source.subscribe('s1', (snapshot) => seen.push(snapshot.state))();

    await loadSdk();
    await Promise.resolve();
    const config: {
      getMissionStore?: (id: string) => { setState(state: string): void } | null;
    } = {};
    source.attach({ controller: { config } });
    config.getMissionStore?.('s1')?.setState('running');
    expect(seen).toEqual([]);
  });
});
