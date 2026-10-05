import { describe, expect, it } from 'vitest';
import { truncateToUtf8Bytes } from './utf8Truncate';

const byteLength = (text: string) => new TextEncoder().encode(text).length;

describe('truncateToUtf8Bytes', () => {
  it('returns short ASCII text unchanged', () => {
    expect(truncateToUtf8Bytes('hello', 10)).toEqual({ text: 'hello', truncated: false });
  });

  it('keeps text that fits exactly in the byte budget', () => {
    expect(truncateToUtf8Bytes('ăă', 4)).toEqual({ text: 'ăă', truncated: false });
  });

  it('caps two-byte characters by bytes, not UTF-16 units', () => {
    const result = truncateToUtf8Bytes('ă'.repeat(10), 8);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('ă'.repeat(4));
    expect(byteLength(result.text)).toBe(8);
  });

  it('never splits a two-byte character at the boundary', () => {
    const result = truncateToUtf8Bytes('ă'.repeat(10), 7);
    expect(result.text).toBe('ă'.repeat(3));
    expect(byteLength(result.text)).toBeLessThanOrEqual(7);
  });

  it('never splits a three-byte character', () => {
    const result = truncateToUtf8Bytes('€'.repeat(10), 8);
    expect(result.text).toBe('€'.repeat(2));
  });

  it('never splits a supplementary-plane surrogate pair', () => {
    const emoji = '😀';
    expect(emoji.length).toBe(2);
    const result = truncateToUtf8Bytes(emoji.repeat(10), 10);
    expect(result.text).toBe(emoji.repeat(2));
    expect(byteLength(result.text)).toBe(8);
  });

  it('handles mixed content and stays valid UTF-16', () => {
    const text = `a${'ă'}b${'€'}c😀d`;
    for (let max = 0; max <= byteLength(text); max++) {
      const { text: out } = truncateToUtf8Bytes(text, max);
      expect(byteLength(out)).toBeLessThanOrEqual(max);
      expect(text.startsWith(out)).toBe(true);
      expect(new TextDecoder().decode(new TextEncoder().encode(out))).toBe(out);
    }
  });

  it('caps a 5 MiB multibyte text at 1 MiB of UTF-8', () => {
    const oneMiB = 1048576;
    const result = truncateToUtf8Bytes('ă'.repeat(oneMiB * 2.5), oneMiB);
    expect(result.truncated).toBe(true);
    expect(byteLength(result.text)).toBe(oneMiB);
  });
});
