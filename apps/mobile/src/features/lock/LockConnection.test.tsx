import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ConnectionStatus, DaemonConnection } from '@droidmobile/daemon-client';
import { resumeApp } from '../../app/useAppResume';
import { i18nReady } from '../../i18n/init';
import { biometrics } from '../../platform/biometrics';
import { SAVED_CONNECTIONS_KEY } from '../../platform/savedConnections';
import {
  createMemorySecureStore,
  getSecureStore,
  setSecureStore,
} from '../../platform/secureStore';
import { useConnectionStore } from '../../stores/connection';
import { useLockStore } from '../../stores/lock';
import { LockScreen } from './LockScreen';

const created = vi.hoisted(() => ({ connections: [] as unknown[] }));

vi.mock('../../platform/biometrics', () => ({
  biometrics: { isAvailable: vi.fn(), authenticate: vi.fn() },
}));

vi.mock('@droidmobile/daemon-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@droidmobile/daemon-client')>();
  return {
    ...original,
    createDaemonConnection: vi.fn(() => {
      let status: ConnectionStatus = 'offline';
      const listeners = new Set<(next: ConnectionStatus) => void>();
      const setStatus = (next: ConnectionStatus) => {
        status = next;
        listeners.forEach((listener) => listener(next));
      };
      const fake = {
        connect: vi.fn(async () => setStatus('ready')),
        retryNow: vi.fn(() => setStatus('reconnecting')),
        disconnect: vi.fn(() => setStatus('offline')),
        onStatus: (listener: (next: ConnectionStatus) => void) => {
          listeners.add(listener);
          listener(status);
          return () => listeners.delete(listener);
        },
        onWarning: () => () => undefined,
        getStatus: () => status,
      };
      created.connections.push(fake);
      return fake as unknown as DaemonConnection;
    }),
  };
});

const authenticate = vi.mocked(biometrics.authenticate);
const SAVED = { id: 'a', label: 'Saved', url: 'ws://127.0.0.1:3101' };

let getSecret: Mock<(id: string) => Promise<string | null>>;
let originalStore: ReturnType<typeof getSecureStore>;

beforeEach(async () => {
  await i18nReady;
  window.localStorage.clear();
  window.localStorage.setItem(
    SAVED_CONNECTIONS_KEY,
    JSON.stringify({ activeId: SAVED.id, connections: [SAVED] }),
  );
  created.connections.length = 0;
  authenticate.mockReset();

  originalStore = getSecureStore();
  const memory = createMemorySecureStore();
  await memory.setSecret(SAVED.id, 'fk-test-key-12345678');
  getSecret = vi.fn((id: string) => memory.getSecret(id));
  setSecureStore({ ...memory, getSecret });

  useConnectionStore.getState().close();
  useConnectionStore.setState({ connection: null, status: 'offline' });
  useLockStore.setState({ enabled: true, locked: true, graceSeconds: 30 });
});

afterEach(() => {
  act(() => {
    useLockStore.setState({ enabled: false, locked: false });
    useConnectionStore.getState().close();
  });
  setSecureStore(originalStore);
});

describe('the app lock gates every connection attempt', () => {
  it.each(['cancelled', 'failed'] as const)(
    'reads no key and opens no socket after a %s prompt, even when the app resumes',
    async (outcome) => {
      authenticate.mockResolvedValue(outcome);
      render(<LockScreen />);
      await screen.findByTestId('lock-error');

      // The prompt activity closing brings the app back to the foreground.
      act(() => resumeApp());
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(getSecret).not.toHaveBeenCalled();
      expect(created.connections).toHaveLength(0);
      expect(useLockStore.getState().locked).toBe(true);
    },
  );

  it('reconnects only after a successful unlock', async () => {
    authenticate.mockResolvedValueOnce('cancelled');
    render(<LockScreen />);
    await screen.findByTestId('lock-error');
    act(() => resumeApp());
    expect(created.connections).toHaveLength(0);

    authenticate.mockResolvedValueOnce('success');
    fireEvent.click(screen.getByTestId('lock-unlock'));
    await waitFor(() => expect(useLockStore.getState().locked).toBe(false));

    expect(getSecret).toHaveBeenCalledTimes(1);
    expect(created.connections).toHaveLength(1);
    expect(useConnectionStore.getState().status).toBe('ready');
  });

  it('resumes normally once unlocked', async () => {
    authenticate.mockResolvedValue('success');
    render(<LockScreen />);
    await waitFor(() => expect(useLockStore.getState().locked).toBe(false));
    useConnectionStore.getState().close();
    useConnectionStore.setState({ connection: null, status: 'offline' });

    act(() => resumeApp());
    await waitFor(() => expect(created.connections).toHaveLength(2));
  });
});
