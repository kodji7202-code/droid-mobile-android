import { describe, expect, it } from 'vitest';
import { buildMessage, buildPushPayload, notificationTag } from './payload';

describe('notificationTag', () => {
  it('groups turn events per session and approvals per session', () => {
    expect(notificationTag('stop', 'sess-1')).toBe('turn:sess-1');
    expect(notificationTag('idle_prompt', 'sess-1')).toBe('turn:sess-1');
    expect(notificationTag('permission_prompt', 'sess-1')).toBe('approvals:sess-1');
  });

  it('is set on the Android notification so the app can replace or withdraw it', () => {
    const message = buildMessage('token', 'stop', 'sess-1');
    expect(message.android?.notification).toEqual({ channelId: 'turns', tag: 'turn:sess-1' });
  });
});

describe('buildPushPayload', () => {
  it('carries only the kind and the session id', () => {
    expect(buildPushPayload('permission_prompt', 'sess-1')).toEqual({
      kind: 'permission_prompt',
      sessionId: 'sess-1',
    });
    expect(Object.keys(buildPushPayload('stop', 'sess-1')).sort()).toEqual(['kind', 'sessionId']);
  });

  it('accepts every bridge event kind', () => {
    for (const kind of ['permission_prompt', 'idle_prompt', 'stop'] as const) {
      expect(buildPushPayload(kind, 'sess-1').kind).toBe(kind);
    }
  });
});
