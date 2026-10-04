import { describe, expect, it } from 'vitest';
import { checkDaemonUrl, isApiKeyFormat, isCleartextUrl } from './validation';
import { parsePairingCode } from './pairing';

const PROBE_KEY = 'fk-invalid-validation-probe';

describe('checkDaemonUrl', () => {
  it.each(['daemon', 'ws://', 'ftp://127.0.0.1:3101', 'http://example.com', '', 'ws://user:pw@host'])(
    'rejects %j as malformed',
    (value) => {
      expect(checkDaemonUrl(value, true)).toEqual({ ok: false, reason: 'malformed' });
    },
  );

  it('accepts ws and wss in debug and trims', () => {
    expect(checkDaemonUrl(' ws://127.0.0.1:3101 ', true)).toEqual({ ok: true, url: 'ws://127.0.0.1:3101' });
    expect(checkDaemonUrl('wss://example.invalid', true).ok).toBe(true);
  });

  it('refuses ws:// when cleartext is not allowed (release) but accepts wss://', () => {
    expect(checkDaemonUrl('ws://127.0.0.1:3101', false)).toEqual({ ok: false, reason: 'insecure' });
    expect(checkDaemonUrl('wss://host.example:8443', false).ok).toBe(true);
  });
});

describe('isCleartextUrl / isApiKeyFormat', () => {
  it('detects ws:// only', () => {
    expect(isCleartextUrl('ws://a')).toBe(true);
    expect(isCleartextUrl('WS://a')).toBe(true);
    expect(isCleartextUrl('wss://a')).toBe(false);
  });

  it('accepts the probe key and rejects free text', () => {
    expect(isApiKeyFormat(PROBE_KEY)).toBe(true);
    expect(isApiKeyFormat('not-a-key')).toBe(false);
    expect(isApiKeyFormat('fk-short')).toBe(false);
  });
});

describe('parsePairingCode', () => {
  it('parses url and key', () => {
    expect(
      parsePairingCode(`droidmobile://pair?v=1&url=ws%3A%2F%2F127.0.0.1%3A3101&key=${PROBE_KEY}`),
    ).toEqual({ url: 'ws://127.0.0.1:3101', key: PROBE_KEY });
  });

  it('parses a url-only payload and a bridge pair', () => {
    expect(parsePairingCode('droidmobile://pair?v=1&url=wss://x.example.invalid')).toEqual({
      url: 'wss://x.example.invalid',
    });
    expect(
      parsePairingCode(
        'droidmobile://pair?v=1&url=wss://x.example.invalid&bridge=https%3A%2F%2Fb.example.invalid&bridgeSecret=s3cret',
      ),
    ).toEqual({
      url: 'wss://x.example.invalid',
      bridge: 'https://b.example.invalid',
      bridgeSecret: 's3cret',
    });
  });

  it.each([
    'hello',
    'https://example.com',
    'droidmobile://pair?v=2&url=wss://x.example.invalid',
    'droidmobile://pair?v=1',
    'droidmobile://pair?v=1&url=ftp://x.example.invalid',
    'droidmobile://pair?v=1&url=wss://x.example.invalid&key=bad',
    'droidmobile://pair?v=1&url=wss://x.example.invalid&bridge=https://b.example.invalid',
    'droidmobile://pair?v=1&url=wss://x.example.invalid&extra=1',
    'droidmobile://pair?v=1&v=1&url=wss://x.example.invalid',
    'droidmobile://pair?v=1&url=wss://x.example.invalid&bridge=ftp://b&bridgeSecret=x',
  ])('rejects %j', (value) => {
    expect(parsePairingCode(value)).toBeNull();
  });
});
