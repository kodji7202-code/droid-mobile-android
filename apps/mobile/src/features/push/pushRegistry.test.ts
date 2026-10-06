import { describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../../platform/bridgeClient';
import type { BridgeClient } from '../../platform/bridgeClient';
import { createMemorySecureStore } from '../../platform/secureStore';
import { PENDING_BRIDGE_SECRET_ID } from '../connect/pairing';
import { createLocalPushStorage, createPushRegistry, PUSH_SECRET_ID } from './pushRegistry';
import type { PushState } from './pushRegistry';

const SECRET = 'pair-secret-probe-0123456789';
const BRIDGE = 'http://10.0.2.2:3102';
const CODE = `droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101&bridge=${encodeURIComponent(BRIDGE)}&bridgeSecret=${SECRET}`;

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

function setup(
  options: {
    token?: string | null;
    register?: () => Promise<void>;
    unregister?: () => Promise<boolean>;
    storage?: Storage;
    failSecretWrite?: boolean;
  } = {},
) {
  const storage = options.storage ?? memoryStorage();
  const secrets = createMemorySecureStore();
  if (options.failSecretWrite) {
    const original = secrets.setSecret.bind(secrets);
    secrets.setSecret = (id, value) =>
      id === PUSH_SECRET_ID ? Promise.reject(new Error('keystore busy')) : original(id, value);
  }
  const bridge = {
    register: vi.fn<BridgeClient['register']>(options.register ?? (() => Promise.resolve())),
    unregister: vi.fn<BridgeClient['unregister']>(
      options.unregister ?? (() => Promise.resolve(true)),
    ),
  } satisfies BridgeClient;
  let token: string | null = options.token === undefined ? 'aaaa:bbbb' : options.token;
  let refresh: ((value: string) => void) | null = null;
  const stopListening = vi.fn();
  const messaging = {
    isSupported: () => true,
    getToken: vi.fn(() => Promise.resolve(token)),
    onTokenRefresh: vi.fn((listener: (value: string) => void) => {
      refresh = listener;
      return stopListening;
    }),
  };
  const states: PushState[] = [];
  const registry = createPushRegistry({
    messaging,
    bridge,
    secrets: () => secrets,
    storage: createLocalPushStorage(storage),
    deviceLabel: () => Promise.resolve('Test phone'),
    newDeviceId: () => 'droid-test0001',
    allowCleartext: () => true,
    onChange: (state) => states.push(state),
  });
  return {
    registry,
    bridge,
    secrets,
    storage,
    states,
    messaging,
    stopListening,
    setToken: (next: string | null) => {
      token = next;
    },
    emitRefresh: (value: string) => refresh?.(value),
    reload: () =>
      createPushRegistry({
        messaging,
        bridge,
        secrets: () => secrets,
        storage: createLocalPushStorage(storage),
        deviceLabel: () => Promise.resolve('Test phone'),
        newDeviceId: () => 'droid-other',
        allowCleartext: () => true,
        onChange: () => undefined,
      }),
  };
}

describe('registration', () => {
  it('registers from a pairing code and keeps the secret only in the secure store', async () => {
    const { registry, bridge, secrets, storage } = setup();
    await expect(registry.registerFromPairingCode(CODE)).resolves.toBe(true);
    expect(bridge.register).toHaveBeenCalledWith(
      { bridge: BRIDGE, secret: SECRET },
      { deviceId: 'droid-test0001', fcmToken: 'aaaa:bbbb', label: 'Test phone' },
    );
    expect(registry.getState()).toMatchObject({
      status: 'registered',
      deviceId: 'droid-test0001',
      label: 'Test phone',
      bridge: BRIDGE,
      error: null,
    });
    expect(await secrets.getSecret(PUSH_SECRET_ID)).toBe(SECRET);
    expect(
      JSON.stringify(
        [...Array(storage.length).keys()].map((i) => storage.getItem(storage.key(i)!)),
      ),
    ).not.toContain(SECRET);
    expect(storage.getItem('droid.push')).toContain(BRIDGE);
  });

  it('rejects codes that are malformed or carry no bridge, calling nothing', async () => {
    const { registry, bridge } = setup();
    await expect(registry.registerFromPairingCode('hello')).resolves.toBe(false);
    expect(registry.getState().error).toBe('pairingInvalid');
    await expect(
      registry.registerFromPairingCode('droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101'),
    ).resolves.toBe(false);
    expect(registry.getState().error).toBe('pairingNoBridge');
    expect(bridge.register).not.toHaveBeenCalled();
  });

  it.each([
    [new BridgeError('unauthorized'), 'unauthorized'],
    [new BridgeError('unreachable'), 'unreachable'],
    [new BridgeError('rate-limited'), 'rateLimited'],
    [new BridgeError('server'), 'server'],
    [new BridgeError('rejected'), 'rejected'],
    [new Error('socket hang up'), 'unreachable'],
  ])('a failed registration (%s) stores nothing and stays unregistered', async (failure, kind) => {
    const { registry, secrets, storage } = setup({ register: () => Promise.reject(failure) });
    await expect(registry.register({ bridge: BRIDGE, secret: SECRET })).resolves.toBe(false);
    expect(registry.getState()).toMatchObject({ status: 'unregistered', error: kind });
    expect(registry.getState().error).not.toContain(SECRET);
    expect(await secrets.getSecret(PUSH_SECRET_ID)).toBeNull();
    expect(storage.getItem('droid.push')).toBeNull();
  });

  it('retries successfully after an unreachable bridge', async () => {
    let up = false;
    const { registry } = setup({
      register: () => (up ? Promise.resolve() : Promise.reject(new BridgeError('unreachable'))),
    });
    await expect(registry.register({ bridge: BRIDGE, secret: SECRET })).resolves.toBe(false);
    up = true;
    await expect(registry.register({ bridge: BRIDGE, secret: SECRET })).resolves.toBe(true);
    expect(registry.getState()).toMatchObject({ status: 'registered', error: null });
  });

  it('validates the address and the secret before touching FCM or the bridge', async () => {
    const { registry, bridge, messaging } = setup();
    await registry.register({ bridge: 'nonsense', secret: SECRET });
    expect(registry.getState().error).toBe('invalidUrl');
    await registry.register({ bridge: BRIDGE, secret: '  ' });
    expect(registry.getState().error).toBe('missingSecret');
    expect(bridge.register).not.toHaveBeenCalled();
    expect(messaging.getToken).not.toHaveBeenCalled();
  });

  it('refuses plain http when cleartext is not allowed', async () => {
    const { bridge } = setup();
    const strict = createPushRegistry({
      messaging: {
        isSupported: () => true,
        getToken: () => Promise.resolve('a:b'),
        onTokenRefresh: () => () => undefined,
      },
      bridge,
      secrets: () => createMemorySecureStore(),
      storage: createLocalPushStorage(memoryStorage()),
      deviceLabel: () => Promise.resolve('x'),
      newDeviceId: () => 'droid-x',
      allowCleartext: () => false,
      onChange: () => undefined,
    });
    await expect(strict.register({ bridge: BRIDGE, secret: SECRET })).resolves.toBe(false);
    expect(strict.getState().error).toBe('insecure');
    expect(bridge.register).not.toHaveBeenCalled();
  });

  it('reports a missing FCM token without calling the bridge', async () => {
    const { registry, bridge } = setup({ token: null });
    await expect(registry.register({ bridge: BRIDGE, secret: SECRET })).resolves.toBe(false);
    expect(registry.getState()).toMatchObject({ status: 'unregistered', error: 'token' });
    expect(bridge.register).not.toHaveBeenCalled();
  });

  it('undoes the registration when the secret cannot be stored', async () => {
    const { registry, bridge, storage } = setup({ failSecretWrite: true });
    await expect(registry.register({ bridge: BRIDGE, secret: SECRET })).resolves.toBe(false);
    expect(registry.getState()).toMatchObject({ status: 'unregistered', error: 'storage' });
    expect(bridge.unregister).toHaveBeenCalledTimes(1);
    expect(storage.getItem('droid.push')).toBeNull();
  });
});

describe('replacing the registration', () => {
  it('registers with the new bridge first, then removes the device from the old one', async () => {
    const { registry, bridge } = setup();
    await registry.register({ bridge: BRIDGE, secret: SECRET });
    const other = 'https://bridge.example.invalid';
    await expect(registry.register({ bridge: other, secret: 'other-secret' })).resolves.toBe(true);
    expect(registry.getState()).toMatchObject({ status: 'registered', bridge: other });
    expect(bridge.register.mock.calls[1]?.[1]).toMatchObject({ deviceId: 'droid-test0001' });
    expect(bridge.unregister).toHaveBeenCalledWith(
      { bridge: BRIDGE, secret: SECRET },
      'droid-test0001',
    );
  });

  it('keeps the old registration when the new bridge refuses', async () => {
    const { registry, bridge } = setup();
    await registry.register({ bridge: BRIDGE, secret: SECRET });
    bridge.register.mockRejectedValueOnce(new BridgeError('unauthorized'));
    await expect(
      registry.register({ bridge: 'https://b.example.invalid', secret: 'x' }),
    ).resolves.toBe(false);
    expect(registry.getState()).toMatchObject({
      status: 'registered',
      bridge: BRIDGE,
      error: 'unauthorized',
    });
    expect(bridge.unregister).not.toHaveBeenCalled();
  });
});

describe('pending pairing from the Connect screen', () => {
  const pending = JSON.stringify({ bridge: BRIDGE, bridgeSecret: SECRET });

  it('exposes only the bridge address and registers with the stored secret, then clears it', async () => {
    const { registry, secrets, bridge } = setup();
    await secrets.setSecret(PENDING_BRIDGE_SECRET_ID, pending);
    await registry.refreshPending();
    expect(registry.getState().pendingBridge).toBe(BRIDGE);
    expect(JSON.stringify(registry.getState())).not.toContain(SECRET);

    await expect(registry.register({ bridge: `${BRIDGE}/` })).resolves.toBe(true);
    expect(bridge.register.mock.calls[0]?.[0]).toEqual({ bridge: BRIDGE, secret: SECRET });
    expect(await secrets.getSecret(PENDING_BRIDGE_SECRET_ID)).toBeNull();
    expect(registry.getState().pendingBridge).toBeNull();
  });

  it('does not lend its secret to a different bridge address', async () => {
    const { registry, secrets, bridge } = setup();
    await secrets.setSecret(PENDING_BRIDGE_SECRET_ID, pending);
    await expect(registry.register({ bridge: 'http://10.0.2.2:9999' })).resolves.toBe(false);
    expect(registry.getState().error).toBe('missingSecret');
    expect(bridge.register).not.toHaveBeenCalled();
  });

  it('keeps it after a failed registration and removes it when discarded', async () => {
    const { registry, secrets } = setup({
      register: () => Promise.reject(new BridgeError('server')),
    });
    await secrets.setSecret(PENDING_BRIDGE_SECRET_ID, pending);
    await registry.register({ bridge: BRIDGE });
    expect(await secrets.getSecret(PENDING_BRIDGE_SECRET_ID)).toBe(pending);
    await registry.refreshPending();
    await registry.discardPending();
    expect(await secrets.getSecret(PENDING_BRIDGE_SECRET_ID)).toBeNull();
    expect(registry.getState().pendingBridge).toBeNull();
  });

  it('ignores a corrupt pending value', async () => {
    const { registry, secrets } = setup();
    await secrets.setSecret(PENDING_BRIDGE_SECRET_ID, '{nope');
    await registry.refreshPending();
    expect(registry.getState().pendingBridge).toBeNull();
  });
});

describe('token refresh', () => {
  it('re-registers the same device id with the new token', async () => {
    const { registry, bridge, emitRefresh } = setup();
    await registry.register({ bridge: BRIDGE, secret: SECRET });
    const stop = registry.start();
    await vi.waitFor(() => expect(bridge.register).toHaveBeenCalledTimes(2));
    emitRefresh('cccc:dddd');
    await vi.waitFor(() => expect(bridge.register).toHaveBeenCalledTimes(3));
    expect(bridge.register.mock.calls[2]).toEqual([
      { bridge: BRIDGE, secret: SECRET },
      { deviceId: 'droid-test0001', fcmToken: 'cccc:dddd', label: 'Test phone' },
    ]);
    stop();
  });

  it('ignores a refresh while unregistered', async () => {
    const { registry, bridge, emitRefresh } = setup();
    registry.start();
    emitRefresh('cccc:dddd');
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.register).not.toHaveBeenCalled();
  });

  it('re-registers at start-up with the current token and survives a failing bridge', async () => {
    const { registry, bridge, reload, setToken } = setup();
    await registry.register({ bridge: BRIDGE, secret: SECRET });
    bridge.register.mockClear();
    setToken('eeee:ffff');
    bridge.register.mockRejectedValueOnce(new BridgeError('unreachable'));
    const restarted = reload();
    expect(restarted.getState().status).toBe('registered');
    restarted.start();
    await vi.waitFor(() => expect(bridge.register).toHaveBeenCalledTimes(1));
    expect(bridge.register.mock.calls[0]?.[1]).toMatchObject({ fcmToken: 'eeee:ffff' });
    expect(restarted.getState().status).toBe('registered');
  });
});

describe('unregistering', () => {
  it('deletes the device from the bridge, then forgets the secret and the registration', async () => {
    const { registry, bridge, secrets, storage } = setup();
    await registry.register({ bridge: BRIDGE, secret: SECRET });
    await expect(registry.unregister()).resolves.toBe(true);
    expect(bridge.unregister).toHaveBeenCalledWith(
      { bridge: BRIDGE, secret: SECRET },
      'droid-test0001',
    );
    expect(registry.getState()).toMatchObject({
      status: 'unregistered',
      bridge: null,
      error: null,
    });
    expect(await secrets.getSecret(PUSH_SECRET_ID)).toBeNull();
    expect(JSON.parse(storage.getItem('droid.push') ?? '{}')).toMatchObject({ registered: false });
  });

  it('stays registered with an error when the bridge is unreachable, and can be forced locally', async () => {
    const { registry, bridge, secrets } = setup();
    await registry.register({ bridge: BRIDGE, secret: SECRET });
    bridge.unregister.mockRejectedValueOnce(new BridgeError('unreachable'));
    await expect(registry.unregister()).resolves.toBe(false);
    expect(registry.getState()).toMatchObject({ status: 'registered', error: 'unregisterFailed' });
    expect(await secrets.getSecret(PUSH_SECRET_ID)).toBe(SECRET);

    await expect(registry.unregister({ force: true })).resolves.toBe(true);
    expect(bridge.unregister).toHaveBeenCalledTimes(1);
    expect(registry.getState().status).toBe('unregistered');
    expect(await secrets.getSecret(PUSH_SECRET_ID)).toBeNull();
  });

  it('is a no-op when nothing is registered', async () => {
    const { registry, bridge } = setup();
    await expect(registry.unregister()).resolves.toBe(true);
    expect(bridge.unregister).not.toHaveBeenCalled();
  });

  it('release removes the device and every local trace, and never rejects', async () => {
    const { registry, bridge, secrets, storage } = setup();
    await registry.register({ bridge: BRIDGE, secret: SECRET });
    bridge.unregister.mockRejectedValueOnce(new BridgeError('unreachable'));
    await expect(registry.release()).resolves.toBeUndefined();
    expect(bridge.unregister).toHaveBeenCalledTimes(1);
    expect(registry.getState()).toMatchObject({ status: 'unregistered', deviceId: null });
    expect(await secrets.getSecret(PUSH_SECRET_ID)).toBeNull();
    expect(storage.getItem('droid.push')).toBeNull();
  });

  it('release without a registration only returns', async () => {
    const { registry, bridge } = setup();
    await registry.release();
    expect(bridge.unregister).not.toHaveBeenCalled();
  });
});
