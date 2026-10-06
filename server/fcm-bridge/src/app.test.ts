import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './testkit.js';

let h: Harness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

const device = { deviceId: 'phone-1', fcmToken: 'token-aaaaaaaaaaaaaaaaaaaa', label: 'S25' };
const stopEvent = { session_id: 'sess-1', hook_event_name: 'Stop' };

describe('GET /healthz', () => {
  it('is unauthenticated, JSON, and exposes no configuration', async () => {
    h = await createHarness();
    const res = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    const dump = JSON.stringify(res.headers) + res.body;
    expect(dump).not.toContain(h.secret);
    expect(dump).not.toMatch(/client_email|private_key|pairing/i);
  });
});

describe('authentication', () => {
  it('returns an identical 401 for missing and wrong credentials on every /v1 route', async () => {
    h = await createHarness();
    const routes = [
      { method: 'POST', url: '/v1/devices', payload: device },
      { method: 'DELETE', url: '/v1/devices/phone-1' },
      { method: 'POST', url: '/v1/events', payload: stopEvent },
    ] as const;
    for (const route of routes) {
      const missing = await h.app.inject(route);
      const wrong = await h.app.inject({ ...route, headers: { authorization: 'Bearer nope' } });
      expect(missing.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(missing.headers['content-type']).toContain('application/json');
      expect(wrong.body).toBe(missing.body);
      expect(missing.body).not.toContain(h.secret);
    }
    expect(h.store.size).toBe(0);
  });

  it('accepts the secret only as a Bearer token', async () => {
    h = await createHarness();
    const basic = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: stopEvent,
      headers: { authorization: `Basic ${h.secret}` },
    });
    expect(basic.statusCode).toBe(401);
    const lower = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: stopEvent,
      headers: { authorization: `bearer ${h.secret}` },
    });
    expect(lower.statusCode).toBe(200);
  });

  it('checks authentication before validation and before the body limit', async () => {
    h = await createHarness({ config: { bodyLimitBytes: 256 } });
    const invalid = await h.app.inject({ method: 'POST', url: '/v1/devices', payload: '{nope' });
    expect(invalid.statusCode).toBe(401);
    const oversized = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: { ...stopEvent, pad: 'x'.repeat(1000) },
    });
    expect(oversized.statusCode).toBe(401);
  });

  it('rejects every unknown /v1 path without a credential', async () => {
    h = await createHarness();
    expect((await h.app.inject({ method: 'GET', url: '/v1/anything' })).statusCode).toBe(401);
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/anything', headers: h.auth })).statusCode,
    ).toBe(404);
  });
});

describe('POST /v1/devices', () => {
  it('registers a device, never echoes the token, and is idempotent per deviceId', async () => {
    h = await createHarness();
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: device,
      headers: h.auth,
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(device.fcmToken);
    expect(created.json()).toEqual({ deviceId: 'phone-1', label: 'S25', created: true });

    const replaced = await h.app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: { ...device, fcmToken: 'token-bbbbbbbbbbbbbbbbbbbb' },
      headers: h.auth,
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.body).not.toContain('token-bbbbbbbbbbbbbbbbbbbb');
    expect(h.store.list()).toHaveLength(1);
    expect(h.store.list()[0]?.fcmToken).toBe('token-bbbbbbbbbbbbbbbbbbbb');
  });

  it('defaults the label to an empty string', async () => {
    h = await createHarness();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: { deviceId: 'a', fcmToken: 't' },
      headers: h.auth,
    });
    expect(res.statusCode).toBe(201);
    expect(h.store.list()[0]?.label).toBe('');
  });

  const secretToken = 'SECRET-TOKEN-VALUE-1234567890';
  const cases: Array<[string, unknown, string]> = [
    ['missing deviceId', { fcmToken: secretToken }, 'deviceId'],
    ['missing fcmToken', { deviceId: 'a' }, 'fcmToken'],
    ['empty fcmToken', { deviceId: 'a', fcmToken: '' }, 'fcmToken'],
    ['whitespace fcmToken', { deviceId: 'a', fcmToken: '   ' }, 'fcmToken'],
    ['non-string deviceId', { deviceId: 5, fcmToken: secretToken }, 'deviceId'],
    ['non-string fcmToken', { deviceId: 'a', fcmToken: 5 }, 'fcmToken'],
    ['label of 65 chars', { deviceId: 'a', fcmToken: secretToken, label: 'l'.repeat(65) }, 'label'],
    ['non-string label', { deviceId: 'a', fcmToken: secretToken, label: 3 }, 'label'],
    ['deviceId of 65 chars', { deviceId: 'd'.repeat(65), fcmToken: secretToken }, 'deviceId'],
    ['deviceId with slash', { deviceId: 'a/b', fcmToken: secretToken }, 'deviceId'],
    ['deviceId with backslash', { deviceId: 'a\\b', fcmToken: secretToken }, 'deviceId'],
    ['deviceId with space', { deviceId: 'a b', fcmToken: secretToken }, 'deviceId'],
    ['array body', [secretToken], 'body'],
  ];

  it.each(cases)(
    'rejects %s with 400 naming the field and storing nothing',
    async (_n, payload, field) => {
      h = await createHarness();
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/devices',
        payload: payload as object,
        headers: h.auth,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.map((f: { field: string }) => f.field)).toContain(field);
      expect(res.body).not.toContain(secretToken);
      expect(h.store.size).toBe(0);
    },
  );

  it('rejects a body that is not JSON with 400 without echoing it, whatever the content type', async () => {
    h = await createHarness();
    for (const contentType of [
      'application/json',
      'text/plain',
      'application/x-www-form-urlencoded',
    ]) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/devices',
        payload: `not json ${secretToken}`,
        headers: { ...h.auth, 'content-type': contentType },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_json');
      expect(res.body).not.toContain(secretToken);
    }
    const empty = await h.app.inject({ method: 'POST', url: '/v1/devices', headers: h.auth });
    expect(empty.statusCode).toBe(400);
  });
});

describe('DELETE /v1/devices/:id', () => {
  it('returns 204 once, then 404, and later events skip the device', async () => {
    h = await createHarness();
    await h.store.upsert(device);
    const first = await h.app.inject({
      method: 'DELETE',
      url: '/v1/devices/phone-1',
      headers: h.auth,
    });
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');
    const second = await h.app.inject({
      method: 'DELETE',
      url: '/v1/devices/phone-1',
      headers: h.auth,
    });
    expect(second.statusCode).toBe(404);
    expect(second.json().error.code).toBe('not_found');
    const event = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: stopEvent,
      headers: h.auth,
    });
    expect(event.json().sent).toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it('answers 404 for ids that could never be registered', async () => {
    h = await createHarness();
    const res = await h.app.inject({ method: 'DELETE', url: '/v1/devices/a%20b', headers: h.auth });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/events validation', () => {
  const bad: Array<[string, unknown, string]> = [
    ['missing session_id', { hook_event_name: 'Stop' }, 'session_id'],
    ['empty session_id', { session_id: '', hook_event_name: 'Stop' }, 'session_id'],
    ['missing hook_event_name', { session_id: 's' }, 'hook_event_name'],
    [
      'unknown hook_event_name',
      { session_id: 's', hook_event_name: 'PreToolUse' },
      'hook_event_name',
    ],
    [
      'Notification without type',
      { session_id: 's', hook_event_name: 'Notification' },
      'notification_type',
    ],
  ];

  it.each(bad)('rejects %s with 400 and calls no sender', async (_n, payload, field) => {
    h = await createHarness();
    await h.store.upsert(device);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: payload as object,
      headers: h.auth,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields.map((f: { field: string }) => f.field)).toContain(field);
    expect(h.sent).toHaveLength(0);
  });

  it('ignores unmapped notification types without calling FCM', async () => {
    h = await createHarness();
    await h.store.upsert(device);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: {
        session_id: 's',
        hook_event_name: 'Notification',
        notification_type: 'auth_success',
      },
      headers: h.auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sent: 0, dryRun: false });
    expect(h.sent).toHaveLength(0);
  });

  it('reports sent 0 with an empty device list and stays healthy', async () => {
    h = await createHarness();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: stopEvent,
      headers: h.auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sent: 0, dryRun: false });
    expect((await h.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it('reports dryRun true from the configuration', async () => {
    h = await createHarness({ config: { dryRun: true } });
    await h.store.upsert(device);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: stopEvent,
      headers: h.auth,
    });
    expect(res.json()).toMatchObject({ sent: 1, dryRun: true });
    expect(h.logLines().some((l) => l.includes('dry-run'))).toBe(true);
  });
});

describe('limits', () => {
  it('answers 429 with Retry-After and JSON after the per-window limit, wrong secrets included', async () => {
    h = await createHarness({ config: { rateLimitMax: 5 } });
    const statuses: number[] = [];
    let first429: Awaited<ReturnType<typeof h.app.inject>> | undefined;
    for (let i = 0; i < 8; i += 1) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/events',
        payload: stopEvent,
        headers: { authorization: 'Bearer wrong' },
      });
      statuses.push(res.statusCode);
      if (res.statusCode === 429 && !first429) first429 = res;
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    expect(Number(first429?.headers['retry-after'])).toBeGreaterThan(0);
    expect(first429?.json().error.code).toBe('rate_limited');
    expect(first429?.headers['content-type']).toContain('application/json');
  });

  it('never rate limits /healthz', async () => {
    h = await createHarness({ config: { rateLimitMax: 2 } });
    for (let i = 0; i < 10; i += 1) {
      expect((await h.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    }
  });

  it('answers 413 for an oversized body and keeps serving', async () => {
    h = await createHarness({ config: { bodyLimitBytes: 512 } });
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: { ...stopEvent, pad: 'x'.repeat(2000) },
      headers: h.auth,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('payload_too_large');
    expect((await h.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });
});

describe('logging', () => {
  it('writes only JSON lines and never a secret, a bearer value or a full token', async () => {
    h = await createHarness();
    const token = 'FULL-TOKEN-0123456789abcdefghij';
    await h.app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: { ...device, fcmToken: token },
      headers: h.auth,
    });
    await h.app.inject({ method: 'POST', url: '/v1/events', payload: stopEvent, headers: h.auth });
    await h.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: stopEvent,
      headers: { authorization: 'Bearer WRONG-SECRET-VALUE' },
    });
    await h.app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: { deviceId: 'x' },
      headers: h.auth,
    });
    await h.app.inject({ method: 'DELETE', url: '/v1/devices/phone-1', headers: h.auth });

    const lines = h.logLines();
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed).toHaveProperty('level');
      expect(parsed).toHaveProperty('time');
      expect(parsed.msg !== undefined || parsed.reqId !== undefined).toBe(true);
    }
    const all = lines.join('\n');
    for (const forbidden of [h.secret, 'WRONG-SECRET-VALUE', token, 'Bearer ']) {
      expect(all).not.toContain(forbidden);
    }
    expect(all).toContain('request completed');
  });
});
