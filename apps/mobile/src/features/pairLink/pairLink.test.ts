import { describe, expect, it } from 'vitest';
import { daemonIdentity, parsePairLink, summarizePairLink } from './pairLink';

const FAKE_KEY = 'fk-fakefakefake0001';
const URL_ONLY = 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101';

describe('parsePairLink', () => {
  it('accepts a URL-only link and a link with key and bridge', () => {
    expect(parsePairLink(URL_ONLY, true)).toEqual({
      kind: 'link',
      payload: { url: 'ws://10.0.2.2:3101' },
    });
    const full = `${URL_ONLY}&key=${FAKE_KEY}&bridge=https%3A%2F%2Fbridge.example.invalid&bridgeSecret=bridge-secret-probe`;
    const parsed = parsePairLink(full, true);
    expect(parsed.kind).toBe('link');
    if (parsed.kind === 'link') {
      expect(parsed.payload.key).toBe(FAKE_KEY);
      expect(parsed.payload.bridge).toBe('https://bridge.example.invalid');
    }
  });

  it.each([
    ['no params', 'droidmobile://pair'],
    ['unknown version', 'droidmobile://pair?v=2&url=wss%3A%2F%2Fx.example.invalid'],
    ['no url', 'droidmobile://pair?v=1'],
    ['wrong url scheme', 'droidmobile://pair?v=1&url=ftp%3A%2F%2Fx.example.invalid'],
    ['not a url', 'droidmobile://pair?v=1&url=not%20a%20url'],
    ['unknown parameter', `${URL_ONLY}&extra=1`],
    ['oversized', `${URL_ONLY}&bridge=${'a'.repeat(5000)}`],
  ])('reports an invalid link for %s', (_name, link) => {
    expect(parsePairLink(link, true)).toEqual({ kind: 'error', error: 'invalid' });
  });

  it('release semantics reject ws:// while debug semantics accept it', () => {
    expect(parsePairLink(URL_ONLY, false)).toEqual({ kind: 'error', error: 'insecure' });
    expect(parsePairLink(URL_ONLY, true).kind).toBe('link');
    expect(
      parsePairLink('droidmobile://pair?v=1&url=wss%3A%2F%2Fpc.example.ts.net', false).kind,
    ).toBe('link');
  });

  it.each(['droidmobile://other?v=1', 'droidmobile://pairing?v=1', 'https://example.com', 'hello'])(
    'ignores %s without a message',
    (uri) => {
      expect(parsePairLink(uri, true)).toEqual({ kind: 'ignored' });
    },
  );
});

describe('summarizePairLink', () => {
  it('exposes hosts and a key flag, never the key or the bridge secret', () => {
    const parsed = parsePairLink(
      `${URL_ONLY}&key=${FAKE_KEY}&bridge=https%3A%2F%2Fbridge.example.invalid%3A8443&bridgeSecret=bridge-secret-probe`,
      true,
    );
    if (parsed.kind !== 'link') throw new Error('expected a link');
    const summary = summarizePairLink(parsed.payload);
    expect(summary).toEqual({
      host: '10.0.2.2:3101',
      hasKey: true,
      bridgeHost: 'bridge.example.invalid:8443',
    });
    expect(JSON.stringify(summary)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(summary)).not.toContain('bridge-secret-probe');
  });
});

describe('daemonIdentity', () => {
  it('matches the same host and port regardless of scheme, case and trailing slash', () => {
    expect(daemonIdentity('ws://10.0.2.2:3101')).toBe(daemonIdentity('ws://10.0.2.2:3101/'));
    expect(daemonIdentity('wss://PC.example.ts.net')).toBe(
      daemonIdentity('ws://pc.example.ts.net'),
    );
    expect(daemonIdentity('ws://10.0.2.2:3101')).not.toBe(daemonIdentity('ws://10.0.2.2:3109'));
  });
});
