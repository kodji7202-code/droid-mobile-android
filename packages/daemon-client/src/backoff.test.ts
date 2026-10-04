import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF, backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('grows exponentially from the initial delay', () => {
    const opts = { initialMs: 500, maxMs: 60000, factor: 2, jitterFraction: 0 };
    expect(backoffDelay(1, opts)).toBe(500);
    expect(backoffDelay(2, opts)).toBe(1000);
    expect(backoffDelay(3, opts)).toBe(2000);
    expect(backoffDelay(4, opts)).toBe(4000);
  });

  it('never exceeds maxMs', () => {
    const opts = { initialMs: 500, maxMs: 15000, factor: 2, jitterFraction: 0 };
    expect(backoffDelay(10, opts)).toBe(15000);
    expect(backoffDelay(50, opts)).toBe(15000);
  });

  it('applies jitter within the configured fraction of the base delay', () => {
    const base = 4000;
    const opts = { initialMs: base, maxMs: 60000, factor: 1, jitterFraction: 0.25 };
    for (let i = 0; i < 200; i += 1) {
      const d = backoffDelay(1, opts);
      expect(d).toBeGreaterThanOrEqual(Math.round(base * 0.75));
      expect(d).toBeLessThanOrEqual(Math.round(base * 1.25));
    }
  });

  it('produces differing delays for successive random draws', () => {
    const opts = { initialMs: 1000, maxMs: 60000, factor: 1, jitterFraction: 0.25 };
    const values = new Set(Array.from({ length: 50 }, () => backoffDelay(1, opts)));
    expect(values.size).toBeGreaterThan(1);
  });

  it('is deterministic for a fixed random source', () => {
    const rand = () => 0.5;
    const opts = { initialMs: 1000, maxMs: 60000, factor: 2, jitterFraction: 0.25 };
    expect(backoffDelay(2, opts, rand)).toBe(backoffDelay(2, opts, rand));
  });

  it('defaults match the documented reconnect policy', () => {
    expect(DEFAULT_BACKOFF.initialMs).toBe(500);
    expect(DEFAULT_BACKOFF.maxMs).toBe(15000);
    expect(DEFAULT_BACKOFF.factor).toBe(2);
    expect(DEFAULT_BACKOFF.jitterFraction).toBe(0.25);
  });

  it('treats attempts below 1 as the first attempt', () => {
    const opts = { initialMs: 500, maxMs: 60000, factor: 2, jitterFraction: 0 };
    expect(backoffDelay(0, opts)).toBe(500);
    expect(backoffDelay(-3, opts)).toBe(500);
  });
});
