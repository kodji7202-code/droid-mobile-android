/**
 * Registration of this phone with the FCM bridge (server/fcm-bridge).
 *
 * The bridge pairing secret lives only in the secure store (Android Keystore). localStorage keeps
 * the non-secret parts: the bridge URL, the device id and the registered flag. A secret that came
 * in through the Connect screen waits in the secure store under {@link PENDING_BRIDGE_SECRET_ID}
 * until a registration consumes it or the user discards it.
 *
 * Dependency-injected like the connection manager so the logic is unit-testable.
 */
import { BridgeError, checkBridgeUrl } from '../../platform/bridgeClient';
import type { BridgeClient } from '../../platform/bridgeClient';
import type { PushMessagingApi } from '../../platform/pushMessaging';
import type { SecureStore } from '../../platform/secureStore';
import { parsePairingCode, PENDING_BRIDGE_SECRET_ID } from '../connect/pairing';

export const PUSH_SECRET_ID = 'push.bridgeSecret';
export const PUSH_STORAGE_KEY = 'droid.push';
/** Secure-store JSON list of devices a bridge may still hold; the secret is needed to retry. */
export const PUSH_REMOVALS_SECRET_ID = 'push.pendingRemovals';
/** Set while a release left the FCM token valid; stored next to the removal queue it belongs to. */
export const PUSH_DELIVERY_SECRET_ID = 'push.deliveryNotStopped';

export type PushStatus = 'unregistered' | 'registering' | 'registered' | 'unregistering';

export type PushErrorKind =
  | 'invalidUrl'
  | 'insecure'
  | 'missingSecret'
  | 'unauthorized'
  | 'unreachable'
  | 'rejected'
  | 'rateLimited'
  | 'server'
  | 'token'
  | 'storage'
  | 'unsupported'
  | 'pairingInvalid'
  | 'pairingNoBridge'
  | 'unregisterFailed';

export interface PushState {
  supported: boolean;
  status: PushStatus;
  deviceId: string | null;
  label: string | null;
  /** Normalised bridge URL of the registration (not secret). */
  bridge: string | null;
  error: PushErrorKind | null;
  /** True while a bridge may still hold a device this phone stopped using; removal is retried. */
  removalPending: boolean;
  /** True after a release could neither invalidate the FCM token nor reach the bridge: push may still arrive. */
  deliveryNotStopped: boolean;
  /** Bridge URL of a pairing code waiting from the Connect screen; its secret is never exposed. */
  pendingBridge: string | null;
}

interface Persisted {
  deviceId: string | null;
  bridge: string | null;
  registered: boolean;
}

export interface PushStorage {
  load(): Persisted;
  save(value: Persisted): void;
}

export interface PushRegistryDeps {
  messaging: PushMessagingApi;
  bridge: BridgeClient;
  secrets(): SecureStore;
  storage: PushStorage;
  deviceLabel(): Promise<string>;
  newDeviceId(): string;
  allowCleartext(): boolean;
  /** Called with every secret before it is used, so diagnostics can scrub it. */
  registerSecret?(secret: string): void;
  onChange(state: PushState): void;
}

export interface PushRegistry {
  getState(): PushState;
  /** Loads the persisted registration and keeps the bridge in step with FCM token changes. */
  start(): () => void;
  /** Reads the pending Connect-screen pairing, if any. */
  refreshPending(): Promise<void>;
  discardPending(): Promise<void>;
  /** `secret` omitted: the pending pairing secret is used when its bridge URL matches. */
  register(input: { bridge: string; secret?: string }): Promise<boolean>;
  registerFromPairingCode(text: string): Promise<boolean>;
  /**
   * Removes the device from the bridge, then forgets the registration. `force` skips the bridge:
   * it invalidates this phone's FCM token so delivery stops, and queues the bridge removal for
   * retry. It fails (staying registered) when the token cannot be invalidated. Without `force`,
   * a removal still queued for an earlier bridge also makes it invalidate the token.
   */
  unregister(options?: { force?: boolean }): Promise<boolean>;
  /**
   * Sign-out path: bridge removal or token invalidation, then the local registration is gone.
   * Never rejects. Resolves false when neither worked: the removals stay queued (in storage that
   * sign-out does not clear) and are retried at the next start.
   */
  release(): Promise<boolean>;
  clearError(): void;
}

function mapError(error: unknown): PushErrorKind {
  if (!(error instanceof BridgeError)) return 'unreachable';
  switch (error.kind) {
    case 'unauthorized':
      return 'unauthorized';
    case 'rate-limited':
      return 'rateLimited';
    case 'server':
      return 'server';
    case 'rejected':
      return 'rejected';
    case 'unreachable':
      return 'unreachable';
  }
}

function parsePending(raw: string | null): { bridge: string; secret: string } | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { bridge?: unknown; bridgeSecret?: unknown };
    if (typeof value.bridge !== 'string' || typeof value.bridgeSecret !== 'string') return null;
    if (value.bridgeSecret === '') return null;
    return { bridge: value.bridge, secret: value.bridgeSecret };
  } catch {
    return null;
  }
}

interface PendingRemoval {
  bridge: string;
  secret: string;
  deviceId: string;
}

function parseRemovals(raw: string | null): PendingRemoval[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingRemoval =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as PendingRemoval).bridge === 'string' &&
        typeof (item as PendingRemoval).secret === 'string' &&
        typeof (item as PendingRemoval).deviceId === 'string',
    );
  } catch {
    return [];
  }
}

export function createLocalPushStorage(storage: Storage | null = safeLocalStorage()): PushStorage {
  const empty: Persisted = { deviceId: null, bridge: null, registered: false };
  return {
    load() {
      try {
        const value = JSON.parse(
          storage?.getItem(PUSH_STORAGE_KEY) ?? 'null',
        ) as Partial<Persisted> | null;
        return {
          deviceId: typeof value?.deviceId === 'string' ? value.deviceId : null,
          bridge: typeof value?.bridge === 'string' ? value.bridge : null,
          registered: value?.registered === true && typeof value.bridge === 'string',
        };
      } catch {
        return empty;
      }
    },
    save(value) {
      try {
        if (!value.deviceId && !value.registered) storage?.removeItem(PUSH_STORAGE_KEY);
        else storage?.setItem(PUSH_STORAGE_KEY, JSON.stringify(value));
      } catch {
        // Best effort; the in-memory state still applies for this run.
      }
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createPushRegistry(deps: PushRegistryDeps): PushRegistry {
  const persisted = deps.storage.load();
  let state: PushState = {
    supported: deps.messaging.isSupported(),
    status: persisted.registered ? 'registered' : 'unregistered',
    deviceId: persisted.deviceId,
    label: null,
    bridge: persisted.registered ? persisted.bridge : null,
    error: null,
    removalPending: false,
    deliveryNotStopped: false,
    pendingBridge: null,
  };
  // One operation at a time: a token refresh must not interleave with a (un)registration.
  let queue: Promise<unknown> = Promise.resolve();

  function emit(patch: Partial<PushState>): void {
    const changed = (Object.keys(patch) as Array<keyof PushState>).some(
      (key) => state[key] !== patch[key],
    );
    if (!changed) return;
    state = { ...state, ...patch };
    deps.onChange(state);
  }

  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  function persist(): void {
    deps.storage.save({
      deviceId: state.deviceId,
      bridge: state.bridge,
      registered: state.status === 'registered' || state.status === 'unregistering',
    });
  }

  async function readPending(): Promise<{ bridge: string; secret: string } | null> {
    try {
      return parsePending(await deps.secrets().getSecret(PENDING_BRIDGE_SECRET_ID));
    } catch {
      return null;
    }
  }

  async function dropPending(): Promise<void> {
    try {
      await deps.secrets().deleteSecret(PENDING_BRIDGE_SECRET_ID);
    } catch {
      // A leftover pending pairing is also removed by sign-out.
    }
    emit({ pendingBridge: null });
  }

  async function refreshPending(): Promise<void> {
    const pending = await readPending();
    const check = pending ? checkBridgeUrl(pending.bridge, deps.allowCleartext()) : null;
    emit({ pendingBridge: check?.ok ? check.url : null });
  }

  async function registerNow(input: { bridge: string; secret?: string }): Promise<boolean> {
    if (!state.supported) return fail('unsupported');
    const check = checkBridgeUrl(input.bridge, deps.allowCleartext());
    if (!check.ok) return fail(check.reason === 'insecure' ? 'insecure' : 'invalidUrl');

    let secret = input.secret?.trim() ?? '';
    if (secret === '') {
      const pending = await readPending();
      const pendingCheck = pending ? checkBridgeUrl(pending.bridge, deps.allowCleartext()) : null;
      if (pending && pendingCheck?.ok && pendingCheck.url === check.url) secret = pending.secret;
    }
    if (secret === '') return fail('missingSecret');
    deps.registerSecret?.(secret);

    const previous = state.status;
    const replaced =
      previous === 'registered' && state.bridge !== null && state.deviceId !== null
        ? { bridge: state.bridge, secret: await readSecret(), deviceId: state.deviceId }
        : null;
    emit({ status: 'registering', error: null });
    const token = await deps.messaging.getToken();
    if (token === null) return failFrom(previous, 'token');

    const deviceId = state.deviceId ?? deps.newDeviceId();
    const label = await deps.deviceLabel();
    try {
      await deps.bridge.register(
        { bridge: check.url, secret },
        { deviceId, fcmToken: token, label },
      );
    } catch (error) {
      return failFrom(previous, mapError(error));
    }

    try {
      await deps.secrets().setSecret(PUSH_SECRET_ID, secret);
    } catch {
      // Without the secret the device could never be unregistered: undo the registration.
      await deps.bridge.unregister({ bridge: check.url, secret }, deviceId).catch(() => false);
      return failFrom(previous, 'storage');
    }
    emit({ status: 'registered', deviceId, label, bridge: check.url, error: null });
    persist();
    // The new registration revives this device id on this bridge: a queued removal must not undo it.
    await updateRemovals((list) =>
      list.filter((item) => item.bridge !== check.url || item.deviceId !== deviceId),
    );
    // A new pairing code can point at another bridge: the old one must not keep this device.
    if (replaced?.secret && replaced.bridge !== check.url) {
      const item = {
        bridge: replaced.bridge,
        secret: replaced.secret,
        deviceId: replaced.deviceId,
      };
      await updateRemovals((list) => [...list, item]);
      await flushRemovals();
    }
    await dropPending();
    return true;
  }

  function fail(error: PushErrorKind): false {
    emit({ error });
    return false;
  }

  function failFrom(previous: PushStatus, error: PushErrorKind): false {
    emit({ status: previous, error });
    return false;
  }

  async function clearLocal(keepDeviceId: boolean): Promise<void> {
    try {
      await deps.secrets().deleteSecret(PUSH_SECRET_ID);
    } catch {
      // Overwritten by the next registration; sign-out retries the delete.
    }
    emit({
      status: 'unregistered',
      bridge: null,
      error: null,
      ...(keepDeviceId ? {} : { deviceId: null }),
    });
    persist();
  }

  async function readSecret(): Promise<string | null> {
    try {
      return await deps.secrets().getSecret(PUSH_SECRET_ID);
    } catch {
      return null;
    }
  }

  async function removeFromBridge(): Promise<'removed' | 'failed'> {
    if (state.bridge === null || state.deviceId === null) return 'removed';
    const secret = await readSecret();
    // No secret means the device can no longer be named to the bridge; only local state is left.
    if (secret === null) return 'removed';
    try {
      await deps.bridge.unregister({ bridge: state.bridge, secret }, state.deviceId);
      return 'removed';
    } catch {
      return 'failed';
    }
  }

  async function readRemovals(): Promise<PendingRemoval[]> {
    try {
      return parseRemovals(await deps.secrets().getSecret(PUSH_REMOVALS_SECRET_ID));
    } catch {
      return [];
    }
  }

  async function updateRemovals(
    change: (list: PendingRemoval[]) => PendingRemoval[],
  ): Promise<void> {
    const next = change(await readRemovals());
    try {
      if (next.length === 0) await deps.secrets().deleteSecret(PUSH_REMOVALS_SECRET_ID);
      else await deps.secrets().setSecret(PUSH_REMOVALS_SECRET_ID, JSON.stringify(next));
    } catch {
      // Without secure storage the queue cannot persist; this run still reports what it knows.
    }
    emit({ removalPending: next.length > 0 });
    // Nothing left that a bridge could push for: delivery is stopped whatever happened to the token.
    if (next.length === 0) await setDeliveryNotStopped(false);
  }

  async function setDeliveryNotStopped(on: boolean): Promise<void> {
    try {
      if (on) await deps.secrets().setSecret(PUSH_DELIVERY_SECRET_ID, '1');
      else await deps.secrets().deleteSecret(PUSH_DELIVERY_SECRET_ID);
    } catch {
      // Without secure storage the flag only lives for this run.
    }
    emit({ deliveryNotStopped: on });
  }

  async function loadDeliveryNotStopped(): Promise<void> {
    try {
      if ((await deps.secrets().getSecret(PUSH_DELIVERY_SECRET_ID)) === '1') {
        emit({ deliveryNotStopped: true });
      }
    } catch {
      // Keep what this run already knows.
    }
  }

  /** Retries every queued bridge removal; an entry leaves the queue once the bridge confirmed it. */
  async function flushRemovals(): Promise<void> {
    const list = await readRemovals();
    emit({ removalPending: list.length > 0 });
    if (list.length === 0) return;
    const done: PendingRemoval[] = [];
    for (const item of list) {
      try {
        await deps.bridge.unregister({ bridge: item.bridge, secret: item.secret }, item.deviceId);
        done.push(item);
      } catch {
        // Retried when the phone is online again and at the next start.
      }
    }
    if (done.length > 0) {
      await updateRemovals((current) =>
        current.filter(
          (i) => !done.some((d) => d.bridge === i.bridge && d.deviceId === i.deviceId),
        ),
      );
    }
  }

  async function unregisterNow(force: boolean): Promise<boolean> {
    if (state.status !== 'registered') return true;
    emit({ status: 'unregistering', error: null });
    // An old bridge that is still queued would keep pushing to the same token, so turning push
    // off is only true once the token is invalidated or that queue is empty.
    if (!force) await flushRemovals();
    if (force || state.removalPending) {
      const secret = await readSecret();
      // The bridge keeps pushing to the unchanged token, so the token itself has to go first.
      if (!(await deps.messaging.deleteToken())) {
        emit({ status: 'registered', error: 'unregisterFailed' });
        return false;
      }
      await setDeliveryNotStopped(false);
      if (state.bridge !== null && state.deviceId !== null && secret !== null) {
        const item = { bridge: state.bridge, secret, deviceId: state.deviceId };
        await updateRemovals((list) => [...list, item]);
      }
      await clearLocal(true);
      await flushRemovals();
      return true;
    }
    if ((await removeFromBridge()) === 'failed') {
      emit({ status: 'registered', error: 'unregisterFailed' });
      return false;
    }
    await clearLocal(true);
    return true;
  }

  /** Retries queued removals and, after a failed release, the token invalidation itself. */
  async function retryRelease(): Promise<void> {
    await loadDeliveryNotStopped();
    await flushRemovals();
    if (state.deliveryNotStopped && state.status === 'unregistered') {
      if (await deps.messaging.deleteToken()) await updateRemovals(() => []);
    }
  }

  async function syncToken(token: string): Promise<void> {
    if (state.status !== 'registered' || state.bridge === null || state.deviceId === null) return;
    const secret = await readSecret();
    if (secret === null) return;
    try {
      await deps.bridge.register(
        { bridge: state.bridge, secret },
        {
          deviceId: state.deviceId,
          fcmToken: token,
          label: state.label ?? (await deps.deviceLabel()),
        },
      );
    } catch {
      // Retried on the next token change and on the next app start.
    }
  }

  return {
    getState: () => state,
    start() {
      void deps.deviceLabel().then((label) => emit({ label }));
      void refreshPending();
      const stopTokens = deps.messaging.onTokenRefresh(
        (token) => void enqueue(() => syncToken(token)),
      );
      void enqueue(retryRelease);
      if (state.status === 'registered') {
        void enqueue(async () => {
          const token = await deps.messaging.getToken();
          if (token !== null) await syncToken(token);
        });
      }
      const retry = () => void enqueue(retryRelease);
      const hasWindow = typeof window !== 'undefined';
      if (hasWindow) window.addEventListener('online', retry);
      return () => {
        stopTokens();
        if (hasWindow) window.removeEventListener('online', retry);
      };
    },
    refreshPending,
    async discardPending() {
      await dropPending();
    },
    register: (input) => enqueue(() => registerNow(input)),
    async registerFromPairingCode(text) {
      const payload = parsePairingCode(text);
      if (payload === null) return fail('pairingInvalid');
      const { bridge, bridgeSecret } = payload;
      if (bridge === undefined || bridgeSecret === undefined) return fail('pairingNoBridge');
      return enqueue(() => registerNow({ bridge, secret: bridgeSecret }));
    },
    unregister: (options) => enqueue(() => unregisterNow(options?.force === true)),
    release: () =>
      enqueue(async () => {
        await flushRemovals();
        let leftBehind = (await readRemovals()).length > 0;
        if (state.status === 'registered') {
          const secret = await readSecret();
          if ((await removeFromBridge()) === 'failed') {
            leftBehind = true;
            if (state.bridge !== null && state.deviceId !== null && secret !== null) {
              const item = { bridge: state.bridge, secret, deviceId: state.deviceId };
              await updateRemovals((list) => [...list, item]);
            }
          }
        }
        // A bridge that could not be reached would keep pushing to this token: invalidate it.
        // If that fails too, the queued removals stay as the only retry owner.
        if (leftBehind && (await deps.messaging.deleteToken())) {
          await updateRemovals(() => []);
          leftBehind = false;
        }
        if (leftBehind) await setDeliveryNotStopped(true);
        await clearLocal(false);
        if (leftBehind) emit({ error: 'unregisterFailed', removalPending: true });
        return !leftBehind;
      }).catch(() => false),
    clearError: () => emit({ error: null }),
  };
}
