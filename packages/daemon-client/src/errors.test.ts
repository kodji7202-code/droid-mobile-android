import { describe, expect, it } from 'vitest';
import { ConnectionError, DaemonClientError } from './errors';

function serialized(error: Error): string {
  return JSON.stringify(error, Object.getOwnPropertyNames(error)) + String(error.cause ?? '');
}

describe('serialized error redaction', () => {
  it('redacts named apiKey/token fields of any credential format in object causes', () => {
    const error = new ConnectionError('failed', {
      cause: {
        apiKey: 'plain-secret-value',
        nested: { token: 'eyJhbGciOi.payload.sig' },
        ok: 'keep',
      },
    });
    const text = serialized(error);
    expect(text).not.toContain('plain-secret-value');
    expect(text).not.toContain('eyJhbGciOi');
    expect(text).toContain('keep');
    expect(text).toContain('[REDACTED]');
  });

  it('redacts named credentials in free-form messages and causes', () => {
    const error = new DaemonClientError(
      'unknown',
      'request failed apiKey=abc123XYZ token: tok_987 Authorization: Bearer zzz.yyy and "secret":"s3cr3t"',
      { cause: new Error('password=hunter2 api_key: k-777') },
    );
    const text = serialized(error);
    for (const leaked of ['abc123XYZ', 'tok_987', 'zzz.yyy', 's3cr3t', 'hunter2', 'k-777']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('still redacts fk- keys and keeps harmless text', () => {
    const error = new ConnectionError('bad fk-abc-123 here', { cause: 'fk-zzz9' });
    expect(serialized(error)).not.toMatch(/fk-abc|fk-zzz/);
    expect(error.message).toBe('bad [REDACTED] here');
  });
});
