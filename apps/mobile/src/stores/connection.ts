import { create } from 'zustand';
import { createDaemonConnection } from '@droidmobile/daemon-client';
import {
  createConnectionManager,
  MissingKeyError,
  TransportPolicyError,
} from '../app/connectionManager';
import type { ConnectionManager, ConnectionManagerState } from '../app/connectionManager';
import { checkDaemonUrl } from '../features/connect/validation';
import { useInteractionStore } from './interactions';
import { isDebugBuild } from '../platform/buildFlavor';
import { getSecureStore } from '../platform/secureStore';
import {
  addSavedConnection,
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
}

export const useConnectionStore = create<ConnectionStore>((set) => {
  const manager = createConnectionManager({
    createConnection: (options) =>
      createDaemonConnection({
        ...options,
        permissionHandler: (sessionId, request) =>
          useInteractionStore.getState().requestPermission(sessionId, request),
        askUserHandler: (sessionId, request) =>
          useInteractionStore.getState().requestAskUser(sessionId, request),
      }),
    loadSavedConnections,
    saveActiveConnection,
    addSavedConnection,
    updateSavedConnection,
    setActiveSavedConnection,
    removeSavedConnection,
    getSecureStore,
    checkUrl: (rawUrl) => checkDaemonUrl(rawUrl, isDebugBuild()),
    onChange: (state) => set(state),
  });

  return {
    ...manager.getState(),
    connect: (url, apiKey) => manager.connect(url, apiKey),
    restore: () => manager.restore(),
    retry: () => manager.retry(),
    close: () => manager.close(),
    clearVersionWarning: () => manager.clearVersionWarning(),
    addConnection: (input) => manager.addConnection(input),
    switchTo: (id) => manager.switchTo(id),
    updateConnection: (id, input) => manager.updateConnection(id, input),
    forget: (id) => manager.forget(id),
  };
});
