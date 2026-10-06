import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../stores/connection';
import { appLog } from './logBuffer';
import { installDiagnosticsCapture, useDiagnosticsStore } from './capture';
import { logFailure } from './failures';

function connectionAt(url: string): DaemonConnection {
  return { url } as DaemonConnection;
}

let uninstall: () => void;

beforeEach(() => {
  appLog.clear();
  useDiagnosticsStore.setState({ lastAuthenticatedAt: null });
  act(() => {
    useConnectionStore.setState({
      connection: connectionAt('ws://127.0.0.1:3101'),
      status: 'offline',
      lastErrorKind: null,
      versionWarning: null,
    });
  });
  uninstall = installDiagnosticsCapture();
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });
});

describe('connection events', () => {
  it('logs each status change with host, transport and the status as code', () => {
    act(() => useConnectionStore.setState({ status: 'connecting' }));
    act(() => useConnectionStore.setState({ status: 'ready' }));
    const entries = appLog.entries();
    expect(entries.map((entry) => entry.code)).toEqual(['connecting', 'ready']);
    expect(entries[1]?.message).toContain('127.0.0.1:3101');
    expect(entries[1]?.message).toContain('ws');
  });

  it('records the time of the last successful authenticate when the status becomes ready', () => {
    const before = Date.now();
    act(() => useConnectionStore.setState({ status: 'ready' }));
    const at = useDiagnosticsStore.getState().lastAuthenticatedAt;
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
  });

  it('keeps the last authenticate time while the connection drops and recovers on a later ready', async () => {
    act(() => useConnectionStore.setState({ status: 'ready' }));
    const first = useDiagnosticsStore.getState().lastAuthenticatedAt;
    act(() => useConnectionStore.setState({ status: 'reconnecting' }));
    expect(useDiagnosticsStore.getState().lastAuthenticatedAt).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 5));
    act(() => useConnectionStore.setState({ status: 'ready' }));
    expect(useDiagnosticsStore.getState().lastAuthenticatedAt!).toBeGreaterThan(first!);
  });

  it('logs a failure kind and a version warning', () => {
    act(() => useConnectionStore.setState({ lastErrorKind: 'auth' }));
    act(() =>
      useConnectionStore.setState({
        versionWarning: {
          localFactoryProtocolVersion: '1.201.1',
          peerFactoryProtocolVersion: '1.244.0',
          method: 'sessions.list',
        },
      }),
    );
    const codes = appLog.entries().map((entry) => entry.code);
    expect(codes).toEqual(['auth', 'version-warning']);
  });
});

describe('logFailure', () => {
  it('logs the error kind as code and a redacted message', () => {
    const error = Object.assign(new Error('rejected fk-probe-key-123 by daemon'), { kind: 'auth' });
    logFailure('connect', error);
    const [entry] = appLog.entries();
    expect(entry).toMatchObject({ level: 'error', source: 'connect', code: 'auth' });
    expect(entry?.message).not.toContain('fk-probe-key-123');
    expect(entry?.message).toContain('[REDACTED]');
  });

  it('falls back to the error name and tolerates non-error values', () => {
    logFailure('connect', new TypeError('boom'));
    logFailure('connect', 'plain text');
    expect(appLog.entries().map((entry) => entry.code)).toEqual(['TypeError', 'unknown']);
  });
});

describe('global capture', () => {
  it('records console errors and still forwards them to the console', () => {
    uninstall();
    const original = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    uninstall = installDiagnosticsCapture();
    console.error('[app] route error', new Error('apiKey=hunter2value exploded'));
    const entry = appLog.entries().find((candidate) => candidate.source === 'console');
    expect(entry?.level).toBe('error');
    expect(entry?.message).toContain('route error');
    expect(entry?.message).not.toContain('hunter2value');
    expect(original).toHaveBeenCalled();
  });

  it('records window errors and unhandled rejections', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'script failed fk-leak-123456' }));
    const rejection = new Event('unhandledrejection');
    Object.assign(rejection, { reason: new Error('async failed') });
    window.dispatchEvent(rejection);
    const messages = appLog.entries().map((entry) => entry.message);
    expect(messages.some((message) => message.includes('script failed'))).toBe(true);
    expect(messages.some((message) => message.includes('async failed'))).toBe(true);
    expect(messages.join('\n')).not.toContain('fk-leak-123456');
  });

  it('restores the console on uninstall', () => {
    const patched = console.error;
    uninstall();
    expect(console.error).not.toBe(patched);
    uninstall = installDiagnosticsCapture();
  });
});
