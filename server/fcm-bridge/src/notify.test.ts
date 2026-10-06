import { afterEach, describe, expect, it } from 'vitest';
import { StubSender, createHarness, type Harness } from './testkit.js';

let h: Harness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

const NOT_REGISTERED = 'messaging/registration-token-not-registered';

async function post(harness: Harness, payload: object) {
  return harness.app.inject({ method: 'POST', url: '/v1/events', payload, headers: harness.auth });
}

describe('unregistered token cleanup', () => {
  it('removes the dead device, still delivers to the other, and does not target it again', async () => {
    const sender = new StubSender({ 'token-X-0000000000000000': NOT_REGISTERED });
    h = await createHarness({ sender });
    await h.store.upsert({ deviceId: 'X', fcmToken: 'token-X-0000000000000000', label: '' });
    await h.store.upsert({ deviceId: 'Y', fcmToken: 'token-Y-0000000000000000', label: '' });

    const first = await post(h, { session_id: 's1', hook_event_name: 'Stop' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ sent: 1, failed: 1, removed: 1, dryRun: false });
    expect(h.store.list().map((d) => d.deviceId)).toEqual(['Y']);
    expect(sender.sent.map((m) => (m as { token: string }).token).sort()).toEqual([
      'token-X-0000000000000000',
      'token-Y-0000000000000000',
    ]);

    const removal = h.logLines().find((l) => l.includes('removed device with unregistered token'));
    expect(removal).toBeDefined();
    expect(removal).toContain('"deviceId":"X"');
    expect(removal).not.toContain('token-X-0000000000000000');

    sender.sent.length = 0;
    const second = await post(h, { session_id: 's1', hook_event_name: 'Stop' });
    expect(second.json()).toMatchObject({ sent: 1, failed: 0, removed: 0 });
    expect(sender.sent).toHaveLength(1);
  });

  it('keeps a device whose send failed for another reason and never throws', async () => {
    const sender = new StubSender({ 'invalid-token-xyz': 'messaging/invalid-argument' });
    h = await createHarness({ sender });
    await h.store.upsert({ deviceId: 'bad', fcmToken: 'invalid-token-xyz', label: '' });
    await h.store.upsert({ deviceId: 'good', fcmToken: 'good-token-0000000000', label: '' });

    const res = await post(h, { session_id: 's', hook_event_name: 'Stop' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sent: 1, failed: 1, removed: 0 });
    expect(h.store.size).toBe(2);
    expect(h.logLines().join('\n')).toContain('messaging/invalid-argument');
    expect((await h.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it('treats an error without a code as a plain per-device failure', async () => {
    h = await createHarness({
      sender: { send: () => Promise.reject(new Error('socket hang up')) },
    });
    await h.store.upsert({ deviceId: 'a', fcmToken: 'token-0000000000000000', label: '' });
    const res = await post(h, { session_id: 's', hook_event_name: 'Stop' });
    expect(res.json()).toMatchObject({ sent: 0, failed: 1, removed: 0 });
    expect(h.store.size).toBe(1);
  });
});

describe('FCM message shape', () => {
  const TOKEN = 'token-shape-0000000000';

  async function capture(payload: object) {
    const sender = new StubSender();
    h = await createHarness({ sender });
    await h.store.upsert({ deviceId: 'a', fcmToken: TOKEN, label: '' });
    const res = await post(h, payload);
    expect(res.statusCode).toBe(200);
    const message = sender.sent[0];
    await h.close();
    h = undefined;
    return message;
  }

  it('maps permission_prompt to approvals, idle_prompt and Stop to turns', async () => {
    const approvals = await capture({
      session_id: 'sess-9',
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
    });
    const idle = await capture({
      session_id: 'sess-9',
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
    });
    const stop = await capture({ session_id: 'sess-9', hook_event_name: 'Stop' });

    expect(approvals).toMatchObject({
      token: TOKEN,
      data: { kind: 'permission_prompt', sessionId: 'sess-9' },
      android: { priority: 'high', notification: { channelId: 'approvals' } },
    });
    expect(idle).toMatchObject({
      data: { kind: 'idle_prompt', sessionId: 'sess-9' },
      android: { notification: { channelId: 'turns' } },
    });
    expect(stop).toMatchObject({
      data: { kind: 'stop', sessionId: 'sess-9' },
      android: { notification: { channelId: 'turns' } },
    });
    for (const message of [approvals, idle, stop]) {
      expect(Object.keys((message as { data: object }).data).sort()).toEqual(['kind', 'sessionId']);
      expect((message as { notification: unknown }).notification).toEqual(
        (approvals as { notification: unknown }).notification,
      );
    }
  });

  it('contains nothing from the hook input beyond the session id', async () => {
    const sentinels = [
      'SENTINEL_PROMPT_TEXT',
      'SENTINEL_FILE_CONTENT',
      'SENTINEL_PATH_C:\\secret\\x',
      'SENTINEL_UNKNOWN_FIELD',
      'SENTINEL_NOTIFICATION_MESSAGE',
    ];
    const noisy = {
      session_id: 'sess-clean',
      message: sentinels[4],
      tool_input: { content: sentinels[1] },
      cwd: sentinels[2],
      transcript_path: sentinels[2],
      prompt: sentinels[0],
      surprise: { nested: sentinels[3] },
    };
    for (const event of [
      { ...noisy, hook_event_name: 'Stop' },
      { ...noisy, hook_event_name: 'Notification', notification_type: 'permission_prompt' },
      { ...noisy, hook_event_name: 'Notification', notification_type: 'idle_prompt' },
    ]) {
      const baseline = await capture({
        session_id: 'sess-clean',
        hook_event_name: event.hook_event_name,
        ...('notification_type' in event ? { notification_type: event.notification_type } : {}),
      });
      const noisyMessage = await capture(event);
      const serialized = JSON.stringify(noisyMessage);
      for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel);
      expect(noisyMessage).toEqual(baseline);
    }
  });
});
