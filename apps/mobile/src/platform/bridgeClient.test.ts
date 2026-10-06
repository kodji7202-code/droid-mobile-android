import { describe, expect, it, vi } from 'vitest';
import { BridgeError, checkBridgeUrl, createBridgeClient } from './bridgeClient';
import type { BridgeRequest, BridgeTransport } from './bridgeClient';

const TARGET = { bridge: 'http://10.0.2.2:3102', secret: 'probe-secret-value' };
const DEVICE = { deviceId: 'droid-1', fcmToken: 'tok:en', label: 'Phone' };

function client(status: number | Error, calls: BridgeRequest[] = []) {
  const transport: BridgeTransport = (request) => {
    calls.push(request);
    return status instanceof Error ? Promise.reject(status) : Promise.resolve({ status });
  };
  return createBridgeClient(transport, 50);
}

describe('checkBridgeUrl', () => {
  it('normalises an origin and strips trailing slashes', () => {
    expect(checkBridgeUrl(' https://bridge.example.invalid/ ', false)).toEqual({
      ok: true,
      url: 'https://bridge.example.invalid',
    });
    expect(checkBridgeUrl('https://b.example.invalid/api//', false)).toEqual({
      ok: true,
      url: 'https://b.example.invalid/api',
    });
  });

  it('allows plain http only when cleartext is allowed', () => {
    expect(checkBridgeUrl('http://10.0.2.2:3102', true)).toEqual({
      ok: true,
      url: 'http://10.0.2.2:3102',
    });
    expect(checkBridgeUrl('http://10.0.2.2:3102', false)).toEqual({
      ok: false,
      reason: 'insecure',
    });
  });

  it.each([
    '',
    'not a url',
    'ftp://b.example.invalid',
    'https://user:pw@b.example.invalid',
    'https://b.example.invalid/?x=1',
    'https://b.example.invalid/#frag',
  ])('rejects %j as malformed', (raw) => {
    expect(checkBridgeUrl(raw, true)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('bridge client', () => {
  it('registers with a bearer secret and the device body', async () => {
    const calls: BridgeRequest[] = [];
    await client(201, calls).register(TARGET, DEVICE);
    expect(calls).toEqual([
      {
        url: 'http://10.0.2.2:3102/v1/devices',
        method: 'POST',
        headers: { Authorization: 'Bearer probe-secret-value', 'Content-Type': 'application/json' },
        body: DEVICE,
      },
    ]);
    await expect(client(200).register(TARGET, DEVICE)).resolves.toBeUndefined();
  });

  it.each([
    [401, 'unauthorized'],
    [429, 'rate-limited'],
    [500, 'server'],
    [400, 'rejected'],
    [404, 'rejected'],
  ])('maps register status %i to %s', async (status, kind) => {
    await expect(client(status).register(TARGET, DEVICE)).rejects.toMatchObject({ kind });
  });

  it('maps a transport failure and a hang to unreachable without leaking the secret', async () => {
    const failure = await client(new Error(`connect to ${TARGET.secret} failed`))
      .register(TARGET, DEVICE)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BridgeError);
    expect((failure as BridgeError).kind).toBe('unreachable');
    expect(String((failure as BridgeError).message)).not.toContain(TARGET.secret);

    const hanging = createBridgeClient(() => new Promise(() => undefined), 20);
    await expect(hanging.register(TARGET, DEVICE)).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('unregisters with DELETE and an encoded device id', async () => {
    const calls: BridgeRequest[] = [];
    await expect(client(204, calls).unregister(TARGET, 'a b')).resolves.toBe(true);
    expect(calls[0]).toMatchObject({
      url: 'http://10.0.2.2:3102/v1/devices/a%20b',
      method: 'DELETE',
      headers: { Authorization: 'Bearer probe-secret-value' },
    });
    expect(calls[0]?.body).toBeUndefined();
  });

  it('treats 404 on DELETE as already gone and other statuses as failures', async () => {
    await expect(client(404).unregister(TARGET, 'x')).resolves.toBe(false);
    await expect(client(401).unregister(TARGET, 'x')).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    const spy = vi.fn(() => Promise.resolve({ status: 500 }));
    await expect(createBridgeClient(spy, 50).unregister(TARGET, 'x')).rejects.toMatchObject({
      kind: 'server',
    });
  });
});
