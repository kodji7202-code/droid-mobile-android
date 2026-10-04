import { describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus, DaemonConnection, VersionMismatchWarning } from '@droidmobile/daemon-client';
import { createConnectionManager, TransportPolicyError } from './connectionManager';
import type { ConnectionManagerDeps, ConnectionManagerState } from './connectionManager';
import type { SavedConnection } from '../platform/savedConnections';

const SAVED: SavedConnection = { id: 'conn-1', label: 'Test daemon', url: 'ws://127.0.0.1:3105' };

function createFakeConnection(options: { connectImpl?: () => Promise<void> } = {}) {
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const warningListeners = new Set<(warning: VersionMismatchWarning) => void>();
  let status: ConnectionStatus = 'offline';

  const setStatus = (next: ConnectionStatus) => {
    status = next;
    for (const listener of statusListeners) listener(next);
  };

  const connection = {
    url: 'ws://127.0.0.1:3105',
    connect: vi.fn(async () => {
      if (options.connectImpl) {
        await options.connectImpl();
        return;
      }
      setStatus('ready');
    }),
    retryNow: vi.fn(() => setStatus('reconnecting')),
    disconnect: vi.fn(() => setStatus('offline')),
    onStatus: (listener: (next: ConnectionStatus) => void) => {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    onWarning: (listener: (warning: VersionMismatchWarning) => void) => {
      warningListeners.add(listener);
      return () => warningListeners.delete(listener);
    },
    getStatus: () => status,
  } as unknown as DaemonConnection;

  return {
    connection,
    connectMock: connection.connect as unknown as ReturnType<typeof vi.fn>,
    disconnectMock: connection.disconnect as unknown as ReturnType<typeof vi.fn>,
    retryNowMock: connection.retryNow as unknown as ReturnType<typeof vi.fn>,
    setStatus,
    emitWarning: (warning: VersionMismatchWarning) => {
      for (const listener of warningListeners) listener(warning);
    },
  };
}

function harness(
  options: {
    saved?: { activeId: string | null; connections: SavedConnection[] };
    key?: string | null;
    connectImpl?: () => Promise<void>;
    checkUrl?: ConnectionManagerDeps['checkUrl'];
  } = {},
) {
  const fake = createFakeConnection({ connectImpl: options.connectImpl });
  const saved = options.saved ?? { activeId: null, connections: [] };
  const secrets = new Map<string, string>();
  if (options.key && saved.activeId) secrets.set(saved.activeId, options.key);
  const states: ConnectionManagerState[] = [];
  const saveActiveConnection = vi.fn();
  const createConnection = vi.fn(() => fake.connection);

  const deps: ConnectionManagerDeps = {
    createConnection,
    loadSavedConnections: vi.fn(() => saved),
    saveActiveConnection,
    addSavedConnection: vi.fn(),
    updateSavedConnection: vi.fn(),
    setActiveSavedConnection: vi.fn(),
    removeSavedConnection: vi.fn(),
    getSecureStore: () => ({
      getSecret: (id) => Promise.resolve(secrets.get(id) ?? null),
      setSecret: (id, secret) => {
        secrets.set(id, secret);
        return Promise.resolve();
      },
      deleteSecret: (id) => {
        secrets.delete(id);
        return Promise.resolve();
      },
    }),
    checkUrl: options.checkUrl ?? ((raw) => ({ ok: true, url: raw })),
    onChange: (state) => states.push(state),
  };

  return {
    manager: createConnectionManager(deps),
    deps,
    fake,
    states,
    secrets,
    createConnection,
    saveActiveConnection,
  };
}

describe('connectionManager.connect', () => {
  it('rejects a transport-policy violation before creating any connection', async () => {
    const { manager, createConnection } = harness({
      checkUrl: () => ({ ok: false, reason: 'insecure' }),
    });
    await expect(manager.connect('ws://127.0.0.1:3105', 'fk-test-key-12345678')).rejects.toBeInstanceOf(
      TransportPolicyError,
    );
    expect(createConnection).not.toHaveBeenCalled();
    expect(manager.getState().connection).toBeNull();
  });

  it('adopts the connection, mirrors status and saves key plus metadata on success', async () => {
    const { manager, fake, saveActiveConnection, secrets, states } = harness();
    await manager.connect('ws://127.0.0.1:3105', 'fk-test-key-12345678');

    const state = manager.getState();
    expect(state.connection).toBe(fake.connection);
    expect(state.status).toBe('ready');
    expect(state.readyEpoch).toBe(1);
    expect(state.lastErrorKind).toBeNull();
    expect(state.activeConnectionId).toBeTruthy();
    expect(secrets.get(state.activeConnectionId!)).toBe('fk-test-key-12345678');
    expect(saveActiveConnection).toHaveBeenCalledWith({
      id: state.activeConnectionId,
      label: '127.0.0.1:3105',
      url: 'ws://127.0.0.1:3105',
    });
    expect(states.at(-1)?.status).toBe('ready');
  });

  it('discards the failed connection and rethrows, keeping the last error kind', async () => {
    const failure = Object.assign(new Error('no daemon'), { kind: 'connection' });
    const { manager, fake, states } = harness({ connectImpl: () => Promise.reject(failure) });

    await expect(manager.connect('ws://127.0.0.1:3105', 'fk-test-key-12345678')).rejects.toBe(failure);
    expect(manager.getState().connection).toBeNull();
    expect(manager.getState().status).toBe('offline');
    expect(manager.getState().lastErrorKind).toBe('connection');

    // The discarded connection's listeners are detached: a late status frame
    // must not leak into the store.
    const count = states.length;
    fake.setStatus('ready');
    expect(states.length).toBe(count);
  });
});

describe('connectionManager.restore', () => {
  it('does nothing without a saved active connection', async () => {
    const { manager, createConnection } = harness();
    await manager.restore();
    expect(createConnection).not.toHaveBeenCalled();
    expect(manager.getState().connection).toBeNull();
  });

  it('does nothing when the saved connection has no key (web reload)', async () => {
    const { manager, createConnection } = harness({
      saved: { activeId: SAVED.id, connections: [SAVED] },
      key: null,
    });
    await manager.restore();
    expect(createConnection).not.toHaveBeenCalled();
    expect(manager.getState().connection).toBeNull();
  });

  it('ignores a saved connection whose URL breaks the transport policy', async () => {
    const { manager, createConnection } = harness({
      saved: { activeId: SAVED.id, connections: [SAVED] },
      key: 'fk-test-key-12345678',
      checkUrl: () => ({ ok: false, reason: 'insecure' }),
    });
    await manager.restore();
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('adopts the saved connection, starts dialling and keeps it when the daemon is down', async () => {
    const failure = Object.assign(new Error('offline'), { kind: 'connection' });
    const { manager, fake, createConnection } = harness({
      saved: { activeId: SAVED.id, connections: [SAVED] },
      key: 'fk-test-key-12345678',
      connectImpl: () => Promise.reject(failure),
    });

    await manager.restore();
    expect(createConnection).toHaveBeenCalledWith({ url: SAVED.url, apiKey: 'fk-test-key-12345678' });
    expect(manager.getState().connection).toBe(fake.connection);
    expect(manager.getState().activeConnectionId).toBe(SAVED.id);

    // The failed attempt keeps the connection (offline shell) and retries in
    // the background without user action.
    await vi.waitFor(() => expect(fake.retryNowMock).toHaveBeenCalled());
    expect(manager.getState().connection).toBe(fake.connection);
  });

  it('does not auto-retry a rejected key at launch', async () => {
    const failure = Object.assign(new Error('rejected'), { kind: 'auth' });
    const { manager, fake } = harness({
      saved: { activeId: SAVED.id, connections: [SAVED] },
      key: 'fk-test-key-12345678',
      connectImpl: () => Promise.reject(failure),
    });

    await manager.restore();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.retryNowMock).not.toHaveBeenCalled();
    expect(manager.getState().connection).toBe(fake.connection);
  });
});

describe('connectionManager.retry', () => {
  it('forces an immediate attempt on the current connection', async () => {
    const { manager, fake } = harness();
    await manager.connect('ws://127.0.0.1:3105', 'fk-test-key-12345678');
    fake.setStatus('reconnecting');

    manager.retry();
    expect(fake.retryNowMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to restoring the saved connection when none is loaded', async () => {
    const { manager, createConnection } = harness({
      saved: { activeId: SAVED.id, connections: [SAVED] },
      key: 'fk-test-key-12345678',
    });
    manager.retry();
    await vi.waitFor(() => expect(createConnection).toHaveBeenCalled());
  });
});

describe('connectionManager state', () => {
  it('bumps readyEpoch on every transition into ready, including reconnects', async () => {
    const { manager, fake } = harness();
    await manager.connect('ws://127.0.0.1:3105', 'fk-test-key-12345678');
    expect(manager.getState().readyEpoch).toBe(1);

    fake.setStatus('reconnecting');
    expect(manager.getState().status).toBe('reconnecting');
    expect(manager.getState().readyEpoch).toBe(1);

    fake.setStatus('ready');
    expect(manager.getState().readyEpoch).toBe(2);
  });

  it('surfaces and clears non-blocking version warnings', async () => {
    const { manager, fake } = harness();
    await manager.connect('ws://127.0.0.1:3105', 'fk-test-key-12345678');

    fake.emitWarning({ localFactoryProtocolVersion: '1.201.1', peerFactoryProtocolVersion: '1.244.0' });
    expect(manager.getState().versionWarning?.peerFactoryProtocolVersion).toBe('1.244.0');

    manager.clearVersionWarning();
    expect(manager.getState().versionWarning).toBeNull();
  });

  it('close() disconnects and returns to the offline state', async () => {
    const { manager, fake } = harness();
    await manager.connect('ws://127.0.0.1:3105', 'fk-test-key-12345678');
    manager.close();
    expect(fake.disconnectMock).toHaveBeenCalledTimes(1);
    expect(manager.getState().connection).toBeNull();
    expect(manager.getState().status).toBe('offline');
  });
});
