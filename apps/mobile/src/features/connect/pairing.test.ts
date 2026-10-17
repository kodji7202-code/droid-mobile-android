import { describe, expect, it } from 'vitest';
import { normalizePairingInput, parsePairingCode } from './pairing';

const KEY = 'fk-invalid-validation-probe';
const URL_ONLY = `droidmobile://pair?v=1&url=${encodeURIComponent('wss://daemon-with-a-long-hostname.example.invalid:8443/some/long/path/segment/that/keeps/going/on/and/on/and/on')}`;
const WITH_BRIDGE = `droidmobile://pair?v=1&url=${encodeURIComponent('wss://daemon-with-a-long-hostname.example.invalid:8443')}&key=${KEY}&bridge=${encodeURIComponent('https://bridge-with-a-long-hostname.example.invalid:8443/base')}&bridgeSecret=bridge-secret-probe`;

const INVISIBLE = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
const SPACES = [' ', '   ', '\t', '\u00A0', ' \t\u00A0 '];
const BREAKS = ['\r\n', '\n', '\r'];

function insertAt(text: string, positions: number[], fill: (index: number) => string): string {
  let out = '';
  let last = 0;
  [...positions]
    .sort((a, b) => a - b)
    .forEach((position, index) => {
      out += text.slice(last, position) + fill(index);
      last = position;
    });
  return out + text.slice(last);
}

function positionsFor(text: string): number[] {
  const afterKey = text.indexOf('key=') + 4;
  const afterUrl = text.indexOf('url=') + 4;
  const insideEscape = text.indexOf('%3A') + 1;
  return [afterUrl, insideEscape, Math.floor(text.length / 2), afterKey > 3 ? afterKey : 60, 100];
}

describe('normalizePairingInput', () => {
  it('leaves a clean pairing code untouched', () => {
    expect(normalizePairingInput(WITH_BRIDGE)).toBe(WITH_BRIDGE);
  });

  it('removes CR, LF and CRLF line breaks', () => {
    expect(normalizePairingInput('droid\r\nmobile://\npair?v=1\r&url=x')).toBe(
      'droidmobile://pair?v=1&url=x',
    );
  });

  it('removes spaces, tabs, NBSP and zero-width characters', () => {
    expect(normalizePairingInput('\uFEFF droid \t mobile\u00A0://pa\u200Bir\u200C?v\u200D=1')).toBe(
      'droidmobile://pair?v=1',
    );
  });

  it.each([
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['<', '>'],
    ['`', '`'],
    ['"<', '>"'],
  ])('removes surrounding %s … %s', (open, close) => {
    expect(normalizePairingInput(`  ${open}\n${URL_ONLY}\r\n${close}  `)).toBe(URL_ONLY);
  });

  it('returns an empty string for blank or invisible-only text', () => {
    expect(normalizePairingInput(' \r\n\t\u00A0\u200B\uFEFF')).toBe('');
  });
});

describe('parsePairingCode with tolerant input', () => {
  for (const [name, code] of [
    ['URL-only', URL_ONLY],
    ['key and bridge', WITH_BRIDGE],
  ] as const) {
    describe(name, () => {
      const expected = parsePairingCode(code);

      it('parses the clean code', () => {
        expect(code.length).toBeGreaterThanOrEqual(150);
        expect(expected).not.toBeNull();
      });

      it.each(BREAKS)('accepts %j inserted at 5 positions', (breakText) => {
        const wrapped = insertAt(code, positionsFor(code), () => breakText);
        expect(wrapped).not.toBe(code);
        expect(parsePairingCode(wrapped)).toEqual(expected);
      });

      it.each(SPACES)('accepts %j runs inserted at 5 positions', (space) => {
        expect(parsePairingCode(insertAt(code, positionsFor(code), () => space))).toEqual(expected);
      });

      it('accepts zero-width characters and BOM at 5 positions', () => {
        const noisy = insertAt(code, positionsFor(code), (i) => INVISIBLE[i % INVISIBLE.length]!);
        expect(parsePairingCode(noisy)).toEqual(expected);
      });

      it.each([
        ['"', '"'],
        ["'", "'"],
        ['“', '”'],
        ['‘', '’'],
        ['<', '>'],
      ])('accepts surrounding %s … %s together with line breaks', (open, close) => {
        const wrapped = `${open}${insertAt(code, positionsFor(code), () => '\r\n')}${close}\n`;
        expect(parsePairingCode(wrapped)).toEqual(expected);
      });
    });
  }

  it.each([
    'hello',
    'https://example.com',
    'droidmobile://pair?v=2&url=wss://x.example.invalid',
    'droidmobile://pair?v=1',
    '',
    ' \r\n ',
  ])('still rejects %j', (value) => {
    expect(parsePairingCode(value)).toBeNull();
    expect(parsePairingCode(`"${value}"\r\n`)).toBeNull();
  });
});
