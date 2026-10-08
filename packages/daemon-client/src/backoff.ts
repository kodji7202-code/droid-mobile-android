/**
 * Jittered exponential backoff for the reconnect loop (design note:
 * "Backoff with jitter"). Pure function; randomness is injectable for tests.
 */
export interface BackoffOptions {
  /** Delay before the first retry. */
  initialMs: number;
  /** Upper bound for any single delay. */
  maxMs: number;
  /** Multiplier per attempt. */
  factor: number;
  /** Random +/- fraction applied to the base delay (0..1). */
  jitterFraction: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  initialMs: 500,
  maxMs: 15000,
  factor: 2,
  jitterFraction: 0.25,
};

/** Delay before retry number `attempt` (1-based; values below 1 count as 1). */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  rand: () => number = Math.random,
): number {
  const clampedAttempt = Math.max(1, Math.floor(attempt));
  const base = Math.min(
    options.maxMs,
    options.initialMs * Math.pow(options.factor, clampedAttempt - 1),
  );
  const jitter = 1 - options.jitterFraction + rand() * 2 * options.jitterFraction;
  return Math.min(options.maxMs, Math.max(0, Math.round(base * jitter)));
}
