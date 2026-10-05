import { describe, expect, it } from 'vitest';
import { applyCtrl, keySequence, wordBounds } from './terminalKeys';

describe('keySequence', () => {
  it('maps Esc and Tab', () => {
    expect(keySequence('esc', false)).toBe('\x1b');
    expect(keySequence('tab', false)).toBe('\t');
  });

  it('uses CSI arrows normally and SS3 arrows in application cursor mode', () => {
    expect(keySequence('up', false)).toBe('\x1b[A');
    expect(keySequence('down', false)).toBe('\x1b[B');
    expect(keySequence('left', false)).toBe('\x1b[D');
    expect(keySequence('right', false)).toBe('\x1b[C');
    expect(keySequence('up', true)).toBe('\x1bOA');
    expect(keySequence('left', true)).toBe('\x1bOD');
  });
});

describe('applyCtrl', () => {
  it('converts letters to control codes', () => {
    expect(applyCtrl('c')).toBe('\x03');
    expect(applyCtrl('C')).toBe('\x03');
    expect(applyCtrl('d')).toBe('\x04');
    expect(applyCtrl('z')).toBe('\x1a');
    expect(applyCtrl('[')).toBe('\x1b');
  });

  it('leaves multi-character input and non-control characters alone', () => {
    expect(applyCtrl('ab')).toBe('ab');
    expect(applyCtrl('5')).toBe('5');
    expect(applyCtrl('\x1b[A')).toBe('\x1b[A');
  });
});

describe('wordBounds', () => {
  it('finds the non-blank run around a column', () => {
    expect(wordBounds('echo hi-123 now', 7)).toEqual({ start: 5, end: 10 });
    expect(wordBounds('echo hi-123 now', 5)).toEqual({ start: 5, end: 10 });
    expect(wordBounds('echo hi-123 now', 10)).toEqual({ start: 5, end: 10 });
  });

  it('returns null on whitespace or past the end of the line', () => {
    expect(wordBounds('echo hi', 4)).toBeNull();
    expect(wordBounds('echo hi', 20)).toBeNull();
  });
});
