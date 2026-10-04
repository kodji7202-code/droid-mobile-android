import { describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus, DaemonConnection } from '@droidmobile/daemon-client';
import {
  createConnectionManager,
  MissingKeyError,
  TransportPolicyError,
} from './connectionManager';
import type { ConnectionManagerDeps } from './connectionManager';
import type { SavedConnection } from '../platform/savedConnections';

const KEY = 'fk-test-key-12345678';
const A: SavedConnection = { id: 'a', label: 'First', url: 'ws://127.0.0.1:3101' };
const B: SavedConnection = { id: 'b', label: 'Second', url: 'ws://127.0.0.1:3105' };

interface FakeConn {
  url: string;
  apiKey: string;
  conn: DaemonConnection;
  disconnect: ReturnType<typeof vi.fn>;
}

function setup(
  options: {
    connections?: SavedConnection[];
    activeId?: string | null;
    keys?: string[];
    failUrls?: string[];
  } = {},
) {
  const saved = {
    activeId: options.activeId === undefined ? A.id : options.activeId,
    connections: [...(options.connections ?? [A, B])],
  };
  const secrets = new Map<string, string>((options.keys ?? ['a', 'b']).map((id) => [id, KEY]));
  const created: FakeConn[] = [];

  const createConnection = vi.fn(({ url, apiKey }: { url: string; apiKey: string }) => {
    let status: ConnectionStatus = 'offline';
    const listeners = new Set<(s: ConnectionStatus) => void>();
    const set = (next: ConnectionStatus) => {
      status = next;
      listeners.forEach((l) => l(next));
    };
    const disconnect = vi.fn(() => set('offline'));
    const conn = {
      connect: vi.fn(async () => {
        if ((options.failUrls ?? []).includes(url)) {
          set('error');
          throw Object.assign(new Error('boom'), {
            kind: apiKey === 'bad' ? 'auth' : 'connection',
          });
        }
        if (apiKey.startsWith('fk-probe')) {
          throw Object.assign(new Error('rejected'), { kind: 'auth' });
        }
        set('ready');
      }),
      retryNow: vi.fn(),
      disconnect,
      onStatus: (l: (s: ConnectionStatus) => void) => {
        listeners.add(l);
        l(status);
        return () => listeners.delete(l);
      },
      onWarning: () => () => undefined,
      getStatus: () => status,
    } as unknown as DaemonConnection;
    created.push({ url, apiKey, conn, disconnect });
    return conn;
  });

  const deps: ConnectionManagerDeps = {
    createConnection,
    loadSavedConnections: () => ({ activeId: saved.activeId, connections: [...saved.connections] }),
    saveActiveConnection: (c) => {
      saved.connections = [...saved.connections.filter((e) => e.id !== c.id), c];
      saved.activeId = c.id;
    },
    addSavedConnection: (c) => {
      saved.connections = [...saved.connections, c];
    },
    updateSavedConnection: (id, patch) => {
      saved.connections = saved.connections.map((e) => (e.id === id ? { ...e, ...patch } : e));
    },
    setActiveSavedConnection: (id) => {
      saved.activeId = id;
    },
    removeSavedConnection: (id) => {
      saved.connections = saved.connections.filter((e) => e.id !== id);
      if (saved.activeId === id) saved.activeId = null;
    },
    getSecureStore: () => ({
      getSecret: (id) => Promise.resolve(secrets.get(id) ?? null),
      setSecret: (id, s) => {
        secrets.set(id, s);
        return Promise.resolve();
      },
      deleteSecret: (id) => {
        secrets.delete(id);
        return Promise.resolve();
      },
    }),
    checkUrl: (raw) =>
      raw.startsWith('ftp') ? { ok: false, reason: 'malformed' } : { ok: true, url: raw },
    onChange: () => undefined,
  };
  return { manager: createConnectionManager(deps), saved, secrets, created, createConnection };
}

describe('addConnection', () => {
  it('validates with a throwaway connection, saves inactive and stores the key', async () => {
    const { manager, saved, secrets, created } = setup();
    const entry = await manager.addConnection({
      label: 'Third',
      url: 'ws://127.0.0.1:3106',
      apiKey: KEY,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.disconnect).toHaveBeenCalled();
    expect(saved.connections.map((c) => c.label)).toEqual(['First', 'Second', 'Third']);
    expect(saved.activeId).toBe('a');
    expect(secrets.get(entry.id)).toBe(KEY);
    expect(manager.getState().savedConnections).toHaveLength(3);
    expect(manager.getState().connection).toBeNull();
  });

  it('rejects an unreachable address or a rejected key without saving anything', async () => {
    const down = setup({ failUrls: ['ws://127.0.0.1:3190'] });
    await expect(
      down.manager.addConnection({ label: 'x', url: 'ws://127.0.0.1:3190', apiKey: KEY }),
    ).rejects.toMatchObject({ kind: 'connection' });
    expect(down.saved.connections).toHaveLength(2);
    expect(down.secrets.size).toBe(2);

    const bad = setup();
    await expect(
      bad.manager.addConnection({
        label: 'x',
        url: 'ws://127.0.0.1:3106',
        apiKey: 'fk-probe-validation',
      }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(bad.saved.connections).toHaveLength(2);
    expect(bad.secrets.size).toBe(2);
  });

  it('applies the transport policy before dialling and defaults the label to the host', async () => {
    const { manager, createConnection } = setup();
    await expect(
      manager.addConnection({ label: '', url: 'ftp://x', apiKey: KEY }),
    ).rejects.toBeInstanceOf(TransportPolicyError);
    expect(createConnection).not.toHaveBeenCalled();

    const entry = await manager.addConnection({
      label: '  ',
      url: 'ws://127.0.0.1:3106',
      apiKey: KEY,
    });
    expect(entry.label).toBe('127.0.0.1:3106');
  });
});

describe('switchTo', () => {
  it('reconnects with the stored key and makes the target the single active one', async () => {
    const { manager, saved, created } = setup();
    await manager.switchTo('b');
    expect(created.at(-1)).toMatchObject({ url: B.url, apiKey: KEY });
    expect(saved.activeId).toBe('b');
    expect(manager.getState().activeConnectionId).toBe('b');
    expect(manager.getState().savedActiveId).toBe('b');
    expect(manager.getState().status).toBe('ready');
  });

  it('keeps a failing target active but usable, and allows switching back', async () => {
    const { manager, created } = setup({ failUrls: [B.url] });
    await manager.switchTo('a');
    await manager.switchTo('b');
    expect(manager.getState().savedActiveId).toBe('b');
    expect(manager.getState().status).toBe('error');
    expect(manager.getState().lastErrorKind).toBe('connection');
    expect(manager.getState().connection).not.toBeNull();

    await manager.switchTo('a');
    expect(manager.getState().status).toBe('ready');
    expect(created.at(-1)?.url).toBe(A.url);
  });

  it('rejects with MissingKeyError and leaves the current connection alone', async () => {
    const { manager, saved } = setup({ keys: ['a'] });
    await manager.switchTo('a');
    await expect(manager.switchTo('b')).rejects.toBeInstanceOf(MissingKeyError);
    expect(saved.activeId).toBe('a');
    expect(manager.getState().status).toBe('ready');
  });
});

describe('updateConnection', () => {
  it('persists label and URL without touching the stored key or the live connection', async () => {
    const { manager, saved, secrets, created } = setup();
    await manager.switchTo('a');
    await manager.updateConnection('a', { label: 'Work PC', url: A.url });
    expect(saved.connections.find((c) => c.id === 'a')?.label).toBe('Work PC');
    expect(secrets.get('a')).toBe(KEY);
    expect(created).toHaveLength(1);
  });

  it('reconnects the active connection when its URL changes', async () => {
    const { manager, created } = setup();
    await manager.switchTo('a');
    await manager.updateConnection('a', { label: 'First', url: 'ws://127.0.0.1:3107' });
    expect(created.at(-1)?.url).toBe('ws://127.0.0.1:3107');
    expect(manager.getState().status).toBe('ready');
  });

  it('validates a new key before saving it and keeps the old data on rejection', async () => {
    const { manager, secrets, saved } = setup();
    await expect(
      manager.updateConnection('b', {
        label: 'Renamed',
        url: B.url,
        apiKey: 'fk-probe-validation',
      }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(secrets.get('b')).toBe(KEY);
    expect(saved.connections.find((c) => c.id === 'b')?.label).toBe('Second');
  });
});

describe('forget', () => {
  it('removes a non-active connection and its key, leaving the active one connected', async () => {
    const { manager, saved, secrets } = setup();
    await manager.switchTo('a');
    await manager.forget('b');
    expect(saved.connections.map((c) => c.id)).toEqual(['a']);
    expect(secrets.has('b')).toBe(false);
    expect(manager.getState().status).toBe('ready');
    expect(manager.getState().activeConnectionId).toBe('a');
  });

  it('forgetting the only connection closes the socket and clears everything', async () => {
    const { manager, saved, secrets, created } = setup({ connections: [A], keys: ['a'] });
    await manager.switchTo('a');
    await manager.forget('a');
    expect(created[0]!.disconnect).toHaveBeenCalled();
    expect(manager.getState().connection).toBeNull();
    expect(manager.getState().savedConnections).toEqual([]);
    expect(saved.activeId).toBeNull();
    expect(secrets.size).toBe(0);
  });

  it('forgetting the active connection falls back to another one that has a key', async () => {
    const { manager, saved, created } = setup();
    await manager.switchTo('a');
    await manager.forget('a');
    expect(saved.activeId).toBe('b');
    expect(created.at(-1)?.url).toBe(B.url);
    expect(manager.getState().connection).not.toBeNull();
  });
});
