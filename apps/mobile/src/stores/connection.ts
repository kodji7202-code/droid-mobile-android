import { create } from 'zustand';
import { createDaemonConnection } from '@droidmobile/daemon-client';
import {
  createConnectionManager,
  MissingKeyError,
  TransportPolicyError,
} from '../app/connectionManager';
import type { ConnectionManager, ConnectionManagerState } from '../app/connectionManager';
import { checkDaemonUrl } from '../features/connect/validation';
import { logFailure } from '../diagnostics/failures';
import { appLog } from '../diagnostics/logBuffer';
import { useInteractionStore } from './interactions';
import { isDebugBuild } from '../platform/buildFlavor';
import { getSecureStore } from '../platform/secureStore';
import { releasePushRegistration } from './push';
import {
  addSavedConnection,
  clearSavedConnections,
  loadSavedConnections,
  removeSavedConnection,
  saveActiveConnection,
  setActiveSavedConnection,
  updateSavedConnection,
} from '../platform/savedConnections';

export { MissingKeyError, TransportPolicyError };

interface ConnectionStore extends ConnectionManagerState {
  /**
   * Applies the transport policy, establishes a daemon connection (one
   * WebSocket, one authenticate frame) and mirrors its status. Only after a
   * successful authenticate are the key (secure store) and the non-secret
   * metadata (localStorage) saved. Concurrent calls share one attempt.
   * Rethrows the classified error and discards the failed connection.
   */
  connect(url: string, apiKey: string): Promise<void>;
  /**
   * Launch path: restores the saved active connection when its key is
   * available (native Keystore; on the web the key is memory-only so this is
   * a no-op after a reload) and keeps it while the daemon is down.
   */
  restore(): Promise<void>;
  /** Manual retry control: immediate attempt, or restore when nothing is loaded. */
  retry(): void;
  /** Tears the current connection down (if any) and returns to offline. */
  close(): void;
  /** Consumes the pending protocol-version warning after showing it. */
  clearVersionWarning(): void;
  addConnection: ConnectionManager['addConnection'];
  switchTo: ConnectionManager['switchTo'];
  updateConnection: ConnectionManager['updateConnection'];
  forget: ConnectionManager['forget'];
  signOut: ConnectionManager['signOut'];
}

/**
 * Runs a connection operation for the diagnostics log: the key it carries is
 * registered for scrubbing before anything can print it, and a failure is
 * logged (redacted) before it propagates unchanged.
 */
async function tracked<T>(
  source: string,
  secret: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (secret) appLog.registerSecret(secret);
  try {
    return await run();
  } catch (error) {
    logFailure(source, error);
    throw error;
  }
}

export const useConnectionStore = create<ConnectionStore>((set) => {
  const manager = createConnectionManager({
    createConnection: (options) =>
      createDaemonConnection({
        ...options,
        permissionHandler: (sessionId, request, generation) =>
          useInteractionStore.getState().requestPermission(sessionId, request, generation),
        askUserHandler: (sessionId, request, generation) =>
          useInteractionStore.getState().requestAskUser(sessionId, request, generation),
        onFacadeLost: (generation) =>
          useInteractionStore.getState().expire({ generation, notify: true }),
      }),
    loadSavedConnections,
    saveActiveConnection,
    addSavedConnection,
    updateSavedConnection,
    setActiveSavedConnection,
    removeSavedConnection,
    clearSavedConnections,
    getSecureStore,
    releasePush: releasePushRegistration,
    checkUrl: (rawUrl) => checkDaemonUrl(rawUrl, isDebugBuild()),
    onChange: (state) => set(state),
  });

  return {
    ...manager.getState(),
    connect: (url, apiKey) => tracked('connect', apiKey, () => manager.connect(url, apiKey)),
    restore: () => manager.restore(),
    retry: () => manager.retry(),
    close: () => manager.close(),
    clearVersionWarning: () => manager.clearVersionWarning(),
    addConnection: (input) =>
      tracked('add-connection', input.apiKey, () => manager.addConnection(input)),
    switchTo: (id) => tracked('switch-connection', undefined, () => manager.switchTo(id)),
    updateConnection: (id, input) =>
      tracked('update-connection', input.apiKey, () => manager.updateConnection(id, input)),
    forget: (id) => manager.forget(id),
    signOut: () => manager.signOut(),
  };
});

/**
 * A dropped, replaced or forgotten connection takes the daemon-side requests with
 * it, whichever screen is mounted. Pending SDK promises are settled here, and a
 * new connection starts without the previous one's expired markers.
 */
useConnectionStore.subscribe((state, previous) => {
  const interactions = useInteractionStore.getState();
  if (state.connection !== previous.connection) {
    interactions.expire();
    useInteractionStore.setState({ expired: {} });
  } else if (state.status !== 'ready' && previous.status === 'ready') {
    interactions.expire({ notify: true });
  }
});
