import { describe, expect, it } from 'vitest';
import { parsePort } from './ports';

describe('parsePort', () => {
  it('accepts ports inside the mission range', () => {
    expect(parsePort('3100')).toBe(3100);
    expect(parsePort('3199')).toBe(3199);
  });

  it('rejects ports outside the range', () => {
    expect(parsePort('3099')).toBeNull();
    expect(parsePort('3200')).toBeNull();
  });

  it('rejects missing, empty and non-numeric input', () => {
    expect(parsePort(undefined)).toBeNull();
    expect(parsePort('')).toBeNull();
    expect(parsePort('abc')).toBeNull();
    expect(parsePort('3101.5')).toBeNull();
  });
});
