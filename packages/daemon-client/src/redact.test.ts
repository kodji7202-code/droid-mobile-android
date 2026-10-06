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

  it('redacts provider style sk- keys such as a custom model key', () => {
    expect(redactSecrets('rejected sk-dummy-0000-NOTAREALKEY by provider')).toBe(
      'rejected [REDACTED] by provider',
    );
    expect(redactSecrets('the sk-short word')).toBe('the sk-short word');
  });

  it('leaves text without keys untouched', () => {
    expect(redactSecrets('connection ready')).toBe('connection ready');
  });
});

describe('redactSecrets credential values', () => {
  it('replaces a Basic authorization value entirely', () => {
    expect(redactSecrets('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: [REDACTED]');
    expect(redactSecrets('got Basic dXNlcjpwYXNz=')).toBe('got Basic [REDACTED]');
  });

  it('replaces quoted values containing spaces', () => {
    expect(redactSecrets('apiKey: "abc def ghi" next')).toBe('apiKey: "[REDACTED]" next');
    expect(redactSecrets("password='p w d' x")).toBe("password='[REDACTED]' x");
    expect(redactSecrets('{"token":"a b c"}')).toBe('{"token":"[REDACTED]"}');
  });

  it('still replaces unquoted values', () => {
    expect(redactSecrets('secret=abc123&x=1')).toBe('secret=[REDACTED]&x=1');
  });
});

describe('redactSecrets escapes and Basic payloads', () => {
  it('consumes escaped quotes so no suffix leaks', () => {
    expect(redactSecrets('password="ab\\"cd-secret" next')).toBe('password="[REDACTED]" next');
    expect(
      redactSecrets(JSON.stringify({ message: 'password="ab\\"cd-secret" end' })),
    ).not.toContain('cd-secret');
    expect(redactSecrets(JSON.stringify({ error: 'bad apiKey: "x\\"yzSUFFIX"' }))).not.toContain(
      'SUFFIX',
    );
  });

  it('redacts Basic payloads of any casing and character mix', () => {
    expect(redactSecrets('got basic dXNlcjpwYXNz')).toBe('got Basic [REDACTED]');
    expect(redactSecrets('got BASIC abcdefghijklmnop')).toBe('got Basic [REDACTED]');
    expect(redactSecrets('got Basic YWJjZGVm')).toBe('got Basic [REDACTED]');
  });
});
