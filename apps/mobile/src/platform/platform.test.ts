import { beforeEach, describe, expect, it } from 'vitest';
import { createMemorySecureStore } from './secureStore';
import {
  addSavedConnection,
  loadSavedConnections,
  removeSavedConnection,
  saveActiveConnection,
  setActiveSavedConnection,
  updateSavedConnection,
  SAVED_CONNECTIONS_KEY,
} from './savedConnections';

describe('memory secure store', () => {
  it('round-trips, deletes, and never touches web storage', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const store = createMemorySecureStore();
    await store.setSecret('a', 'fk-secret-value-123');
    expect(await store.getSecret('a')).toBe('fk-secret-value-123');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    await store.deleteSecret('a');
    expect(await store.getSecret('a')).toBeNull();
  });

  it('is empty for a fresh instance (reload loses the key)', async () => {
    expect(await createMemorySecureStore().getSecret('a')).toBeNull();
  });
});

describe('saved connections', () => {
  beforeEach(() => window.localStorage.clear());

  it('is empty by default and tolerates corrupt data', () => {
    expect(loadSavedConnections().connections).toEqual([]);
    window.localStorage.setItem(SAVED_CONNECTIONS_KEY, '{nope');
    expect(loadSavedConnections().connections).toEqual([]);
  });

  it('upserts by id, marks it active, and persists only id/label/url', () => {
    saveActiveConnection({ id: '1', label: 'PC', url: 'ws://h:1' });
    saveActiveConnection({ id: '1', label: 'Work PC', url: 'ws://h:1' });
    const state = loadSavedConnections();
    expect(state.activeId).toBe('1');
    expect(state.connections).toEqual([{ id: '1', label: 'Work PC', url: 'ws://h:1' }]);
    expect(window.localStorage.getItem(SAVED_CONNECTIONS_KEY)).not.toMatch(/fk-/);
  });
});

describe('saved connection management', () => {
  it('adds without changing the active marker, updates, re-activates and removes', () => {
    window.localStorage.clear();
    saveActiveConnection({ id: 'a', label: 'A', url: 'ws://h:1' });
    addSavedConnection({ id: 'b', label: 'B', url: 'ws://h:2' });
    expect(loadSavedConnections().activeId).toBe('a');

    updateSavedConnection('b', { label: 'Work PC' });
    setActiveSavedConnection('b');
    expect(loadSavedConnections()).toEqual({
      activeId: 'b',
      connections: [
        { id: 'a', label: 'A', url: 'ws://h:1' },
        { id: 'b', label: 'Work PC', url: 'ws://h:2' },
      ],
    });

    removeSavedConnection('b');
    expect(loadSavedConnections()).toEqual({
      activeId: null,
      connections: [{ id: 'a', label: 'A', url: 'ws://h:1' }],
    });
  });
});
