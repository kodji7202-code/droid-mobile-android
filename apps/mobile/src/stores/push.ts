import { create } from 'zustand';
import { createLocalPushStorage, createPushRegistry } from '../features/push/pushRegistry';
import type { PushRegistry, PushState } from '../features/push/pushRegistry';
import { appLog } from '../diagnostics/logBuffer';
import { bridgeClient } from '../platform/bridgeClient';
import { isDebugBuild } from '../platform/buildFlavor';
import { deviceLabel } from '../platform/deviceLabel';
import { pushMessaging } from '../platform/pushMessaging';
import { getSecureStore } from '../platform/secureStore';

function newDeviceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `droid-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

type PushStore = PushState &
  Pick<PushRegistry, 'register' | 'registerFromPairingCode'> &
  Pick<PushRegistry, 'unregister' | 'refreshPending' | 'discardPending' | 'clearError'>;

const registry: PushRegistry = createPushRegistry({
  messaging: pushMessaging,
  bridge: bridgeClient,
  secrets: getSecureStore,
  storage: createLocalPushStorage(),
  deviceLabel,
  newDeviceId,
  allowCleartext: isDebugBuild,
  registerSecret: (secret) => appLog.registerSecret(secret),
  onChange: (state) => usePushStore.setState(state),
});

/** Push registration state and actions for the UI. */
export const usePushStore = create<PushStore>(() => ({
  ...registry.getState(),
  register: (input) => registry.register(input),
  registerFromPairingCode: (text) => registry.registerFromPairingCode(text),
  unregister: (options) => registry.unregister(options),
  refreshPending: () => registry.refreshPending(),
  discardPending: () => registry.discardPending(),
  clearError: () => registry.clearError(),
}));

/** App-level lifecycle: token refresh listener and the start-up re-registration. */
export const startPushRegistry = (): (() => void) => registry.start();

/** Sign-out and forgetting the last connection. Never rejects. */
export const releasePushRegistration = (): Promise<boolean> => registry.release();
