import { describe, expect, it } from 'vitest';
import { buildLogReport, describeEndpoint, reportFileName } from './report';
import { createLogBuffer } from './logBuffer';

describe('describeEndpoint', () => {
  it('returns host and transport without path, query or credentials', () => {
    expect(describeEndpoint('ws://127.0.0.1:3101/path?token=abc')).toEqual({
      host: '127.0.0.1:3101',
      transport: 'ws',
    });
    expect(describeEndpoint('wss://user:pw@pc.tailnet.ts.net:8443')).toEqual({
      host: 'pc.tailnet.ts.net:8443',
      transport: 'wss',
    });
  });

  it('returns null for something that is not a URL', () => {
    expect(describeEndpoint('not a url')).toBeNull();
    expect(describeEndpoint(null)).toBeNull();
  });
});

describe('buildLogReport', () => {
  const context = {
    generatedAt: '2026-10-06T10:00:00.000Z',
    appVersion: '1.0.0',
    platform: 'android',
    sdkVersion: '0.9.1',
    daemonVersion: '0.232.0',
    protocolVersion: '1.244.0',
    status: 'ready',
    host: '127.0.0.1:3101',
    transport: 'ws',
    lastAuthenticatedAt: '2026-10-06T09:59:00.000Z',
  };

  it('lists the context, the redaction notice and every event with its timestamp and code', () => {
    const log = createLogBuffer({ now: () => new Date('2026-10-06T09:58:00.000Z') });
    log.add({ level: 'error', source: 'connection', message: 'connect failed', code: 'auth' });
    const report = buildLogReport(log, context);
    expect(report).toContain('app version: 1.0.0');
    expect(report).toContain('daemon: 127.0.0.1:3101 (ws)');
    expect(report).toContain('daemon version: 0.232.0');
    expect(report).toContain('credentials: [REDACTED]');
    expect(report).toContain('2026-10-06T09:58:00.000Z ERROR connection [auth] connect failed');
  });

  it('never contains a registered or pattern-matched secret, even in the context', () => {
    const log = createLogBuffer();
    log.registerSecret('sk-dummy-0000-NOTAREALKEY');
    log.add({
      level: 'error',
      source: 'models',
      message: 'save failed for sk-dummy-0000-NOTAREALKEY via Bearer abc.def.ghi key fk-probe-123',
    });
    const report = buildLogReport(log, {
      ...context,
      host: 'fk-leaky-host-key:3101',
    });
    expect(report).not.toMatch(/NOTAREALKEY|abc\.def\.ghi|fk-probe-123|fk-leaky|Bearer /);
    expect(report).toContain('[REDACTED]');
  });

  it('says so when there are no events', () => {
    const report = buildLogReport(createLogBuffer(), context);
    expect(report).toContain('events: none recorded');
  });
});

describe('reportFileName', () => {
  it('builds a filesystem-safe name from the timestamp', () => {
    expect(reportFileName(new Date('2026-10-06T10:05:07.123Z'))).toBe(
      'droid-mobile-logs-20261006-100507.txt',
    );
  });
});
