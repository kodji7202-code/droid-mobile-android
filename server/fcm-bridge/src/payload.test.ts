import { describe, expect, it } from 'vitest';
import { buildPushPayload } from './payload';

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
