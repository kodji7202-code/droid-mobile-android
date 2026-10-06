import { describe, expect, it } from 'vitest';
import { createLogBuffer } from './logBuffer';

const FIXED = new Date('2026-10-06T10:00:00.000Z');

function buffer(capacity?: number) {
  return createLogBuffer({ capacity, now: () => FIXED });
}

describe('createLogBuffer', () => {
  it('records timestamped entries in order', () => {
    const log = buffer();
    log.add({ level: 'info', source: 'connection', message: 'status ready', code: 'ready' });
    log.add({ level: 'error', source: 'connection', message: 'connect failed', code: 'auth' });
    expect(log.entries()).toEqual([
      {
        at: '2026-10-06T10:00:00.000Z',
        level: 'info',
        source: 'connection',
        message: 'status ready',
        code: 'ready',
      },
      {
        at: '2026-10-06T10:00:00.000Z',
        level: 'error',
        source: 'connection',
        message: 'connect failed',
        code: 'auth',
      },
    ]);
  });

  it('drops the oldest entries beyond the capacity', () => {
    const log = buffer(3);
    for (let index = 0; index < 5; index += 1) {
      log.add({ level: 'info', source: 'test', message: `event ${index}` });
    }
    expect(log.entries().map((entry) => entry.message)).toEqual(['event 2', 'event 3', 'event 4']);
  });

  it('redacts Factory keys, bearer tokens and named credentials when an entry is added', () => {
    const log = buffer();
    log.add({
      level: 'error',
      source: 'test',
      message: 'rejected fk-abcDEF123-secret with Bearer abc.def.ghi and apiKey=hunter2value',
    });
    const [entry] = log.entries();
    expect(entry?.message).not.toMatch(/fk-abcDEF123|abc\.def\.ghi|hunter2value/);
    expect(entry?.message).toContain('[REDACTED]');
  });

  it('scrubs registered secrets of any shape, including ones added after the entry', () => {
    const log = buffer();
    log.add({
      level: 'warn',
      source: 'test',
      message: 'model key sk-dummy-0000-NOTAREALKEY rejected',
    });
    log.registerSecret('sk-dummy-0000-NOTAREALKEY');
    log.add({ level: 'warn', source: 'test', message: 'retry with sk-dummy-0000-NOTAREALKEY' });
    for (const entry of log.entries()) {
      expect(entry.message).not.toContain('NOTAREALKEY');
    }
    expect(log.scrub('again sk-dummy-0000-NOTAREALKEY')).toBe('again [REDACTED]');
  });

  it('ignores secrets that are too short to be real credentials', () => {
    const log = buffer();
    log.registerSecret('abc');
    expect(log.scrub('abc stays')).toBe('abc stays');
  });

  it('truncates very long messages', () => {
    const log = buffer();
    log.add({ level: 'info', source: 'test', message: 'x'.repeat(5000) });
    expect(log.entries()[0]?.message.length).toBeLessThanOrEqual(1001);
  });

  it('clears every entry but keeps the registered secrets', () => {
    const log = buffer();
    log.registerSecret('secret-value-123');
    log.add({ level: 'info', source: 'test', message: 'one' });
    log.clear();
    expect(log.entries()).toEqual([]);
    expect(log.scrub('secret-value-123')).toBe('[REDACTED]');
  });

  it('notifies subscribers when entries change', () => {
    const log = buffer();
    let calls = 0;
    const unsubscribe = log.subscribe(() => (calls += 1));
    log.add({ level: 'info', source: 'test', message: 'one' });
    unsubscribe();
    log.add({ level: 'info', source: 'test', message: 'two' });
    expect(calls).toBe(1);
  });
});
