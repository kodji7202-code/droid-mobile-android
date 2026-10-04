import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('redacts a Factory API key inside an error message', () => {
    expect(redactSecrets('auth failed for key fk-abc123-def')).toBe(
      'auth failed for key [REDACTED]',
    );
  });

  it('redacts every occurrence', () => {
    expect(redactSecrets('fk-a1 then fk-b2')).toBe('[REDACTED] then [REDACTED]');
  });

  it('leaves text without keys untouched', () => {
    expect(redactSecrets('connection ready')).toBe('connection ready');
  });
});
