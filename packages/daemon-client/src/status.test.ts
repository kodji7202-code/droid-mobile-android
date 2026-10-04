import { describe, expect, it } from 'vitest';
import {
  CONNECTION_FAILURES_BEFORE_OFFLINE,
  INITIAL_CONNECTION_STATE,
  reduceConnectionState,
} from './status';
import type { ConnectionMachineEvent } from './status';

describe('reduceConnectionState', () => {
  it('starts offline before any attempt, then walks the connect phases', () => {
    expect(INITIAL_CONNECTION_STATE.status).toBe('offline');
    expect(INITIAL_CONNECTION_STATE.everReady).toBe(false);
    let s = INITIAL_CONNECTION_STATE;
    s = reduceConnectionState(s, { type: 'attempt-start' });
    expect(s.status).toBe('connecting');
  });

  it('stays connecting through the attempt and auth phases, then becomes ready', () => {
    let s = INITIAL_CONNECTION_STATE;
    s = reduceConnectionState(s, { type: 'attempt-start' });
    expect(s.status).toBe('connecting');
    s = reduceConnectionState(s, { type: 'auth-start' });
    expect(s.status).toBe('authenticating');
    s = reduceConnectionState(s, { type: 'ready' });
    expect(s.status).toBe('ready');
    expect(s.everReady).toBe(true);
    expect(s.consecutiveFailures).toBe(0);
  });

  it('a transient failure on the first attempt leaves the connection offline', () => {
    let s = INITIAL_CONNECTION_STATE;
    s = reduceConnectionState(s, { type: 'attempt-start' });
    s = reduceConnectionState(s, { type: 'attempt-failed', failureKind: 'transient' });
    expect(s.status).toBe('offline');
    expect(s.everReady).toBe(false);
    expect(s.consecutiveFailures).toBe(1);
  });

  it('an auth rejection is a terminal error state', () => {
    let s = INITIAL_CONNECTION_STATE;
    s = reduceConnectionState(s, { type: 'ready' });
    s = reduceConnectionState(s, { type: 'attempt-failed', failureKind: 'auth' });
    expect(s.status).toBe('error');
  });

  it('after having been ready a transient failure enters reconnecting', () => {
    let s = reduceConnectionState(INITIAL_CONNECTION_STATE, { type: 'ready' });
    s = reduceConnectionState(s, { type: 'transport-lost' });
    expect(s.status).toBe('reconnecting');
    s = reduceConnectionState(s, { type: 'attempt-start' });
    expect(s.status).toBe('reconnecting');
    s = reduceConnectionState(s, { type: 'attempt-failed', failureKind: 'transient' });
    expect(s.status).toBe('reconnecting');
    expect(s.consecutiveFailures).toBe(1);
  });

  it(`switches to offline after ${CONNECTION_FAILURES_BEFORE_OFFLINE} consecutive failures but keeps everReady`, () => {
    let s = reduceConnectionState(INITIAL_CONNECTION_STATE, { type: 'ready' });
    for (let i = 1; i <= CONNECTION_FAILURES_BEFORE_OFFLINE; i += 1) {
      s = reduceConnectionState(s, { type: 'attempt-failed', failureKind: 'transient' });
      if (i < CONNECTION_FAILURES_BEFORE_OFFLINE) expect(s.status).toBe('reconnecting');
    }
    expect(s.status).toBe('offline');
    expect(s.everReady).toBe(true);
  });

  it('a successful attempt resets the failure counter', () => {
    let s = reduceConnectionState(INITIAL_CONNECTION_STATE, { type: 'ready' });
    s = reduceConnectionState(s, { type: 'attempt-failed', failureKind: 'transient' });
    s = reduceConnectionState(s, { type: 'attempt-failed', failureKind: 'transient' });
    s = reduceConnectionState(s, { type: 'ready' });
    expect(s.consecutiveFailures).toBe(0);
    expect(s.status).toBe('ready');
  });

  it('an explicit disconnect goes offline without losing everReady', () => {
    let s = reduceConnectionState(INITIAL_CONNECTION_STATE, { type: 'ready' });
    s = reduceConnectionState(s, { type: 'disconnected' });
    expect(s.status).toBe('offline');
    expect(s.everReady).toBe(true);
  });

  it('transport-lost is ignored before the first ready state', () => {
    let s = INITIAL_CONNECTION_STATE;
    s = reduceConnectionState(s, { type: 'attempt-start' });
    s = reduceConnectionState(s, { type: 'transport-lost' });
    expect(s.status).toBe('connecting');
  });

  it('a full reconnect cycle passes ready -> reconnecting -> ready', () => {
    let s = reduceConnectionState(INITIAL_CONNECTION_STATE, { type: 'ready' });
    const events: ConnectionMachineEvent[] = [
      { type: 'transport-lost' },
      { type: 'attempt-start' },
      { type: 'ready' },
    ];
    for (const e of events) s = reduceConnectionState(s, e);
    expect(s.status).toBe('ready');
    expect(s.everReady).toBe(true);
  });
});
