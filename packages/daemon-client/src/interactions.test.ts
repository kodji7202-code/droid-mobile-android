import { describe, expect, it } from 'vitest';
import { canApproveAlways, cancelledAskUser, permissionAnswer } from './interactions';
import type { PermissionRequest } from './interactions';

function request(values: string[]): PermissionRequest {
  return {
    toolUses: [],
    options: values.map((value) => ({ value, label: value })),
  } as unknown as PermissionRequest;
}

describe('permissionAnswer', () => {
  const full = request(['proceed_once', 'proceed_always', 'cancel']);

  it('maps approve once, approve always and deny to the daemon outcomes', () => {
    expect(permissionAnswer(full, 'once')).toBe('proceed_once');
    expect(permissionAnswer(full, 'always')).toBe('proceed_always');
    expect(permissionAnswer(full, 'deny')).toBe('cancel');
  });

  it('prefers plain proceed_always over the exact-path variant', () => {
    const r = request(['proceed_once', 'proceed_always_file', 'proceed_always', 'cancel']);
    expect(permissionAnswer(r, 'always')).toBe('proceed_always');
  });

  it('falls back to a proceed_always variant and reports when none is offered', () => {
    const variant = request(['proceed_once', 'proceed_always_server', 'cancel']);
    expect(permissionAnswer(variant, 'always')).toBe('proceed_always_server');
    const none = request(['proceed_once', 'cancel']);
    expect(canApproveAlways(none)).toBe(false);
    expect(canApproveAlways(full)).toBe(true);
    expect(permissionAnswer(none, 'always')).toBe('proceed_once');
  });
});

describe('cancelledAskUser', () => {
  it('is a cancelled response without answers', () => {
    expect(cancelledAskUser()).toEqual({ cancelled: true, answers: [] });
  });
});
