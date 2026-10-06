import { create } from 'zustand';
import { useConnectionStore } from '../stores/connection';
import { appLog } from './logBuffer';
import { describeValue } from './failures';
import type { LogLevel } from './logBuffer';
import { describeEndpoint } from './report';

interface DiagnosticsState {
  /** Epoch ms of the last transition into `ready` (a successful `daemon.authenticate`). */
  lastAuthenticatedAt: number | null;
}

export const useDiagnosticsStore = create<DiagnosticsState>(() => ({
  lastAuthenticatedAt: null,
}));

const WARNING_STATUSES: readonly string[] = ['reconnecting', 'offline'];

function statusLevel(status: string): LogLevel {
  if (status === 'error') return 'error';
  return WARNING_STATUSES.includes(status) ? 'warn' : 'info';
}

function endpointText(url: string | null | undefined): string {
  const endpoint = describeEndpoint(url ?? null);
  return endpoint ? `host=${endpoint.host} transport=${endpoint.transport}` : 'host=unknown';
}

function subscribeToConnection(): () => void {
  return useConnectionStore.subscribe((state, previous) => {
    if (state.status !== previous.status) {
      appLog.add({
        level: statusLevel(state.status),
        source: 'connection',
        message: `status ${state.status} ${endpointText(state.connection?.url)}`,
        code: state.status,
      });
      if (state.status === 'ready') {
        useDiagnosticsStore.setState({ lastAuthenticatedAt: Date.now() });
      }
    }
    if (state.lastErrorKind && state.lastErrorKind !== previous.lastErrorKind) {
      appLog.add({
        level: 'error',
        source: 'connection',
        message: `connection failed ${endpointText(state.connection?.url)}`,
        code: state.lastErrorKind,
      });
    }
    if (state.versionWarning && state.versionWarning !== previous.versionWarning) {
      const warning = state.versionWarning;
      appLog.add({
        level: 'warn',
        source: 'connection',
        message: `protocol mismatch local=${warning.localFactoryProtocolVersion} daemon=${warning.peerFactoryProtocolVersion}${
          warning.method ? ` method=${warning.method}` : ''
        }`,
        code: 'version-warning',
      });
    }
  });
}

function captureConsole(): () => void {
  const originalWarn = console.warn;
  const originalError = console.error;
  const wrap =
    (level: LogLevel, original: typeof console.warn) =>
    (...args: unknown[]) => {
      appLog.add({ level, source: 'console', message: args.map(describeValue).join(' ') });
      original.apply(console, args);
    };
  console.warn = wrap('warn', originalWarn);
  console.error = wrap('error', originalError);
  return () => {
    console.warn = originalWarn;
    console.error = originalError;
  };
}

function captureWindowErrors(): () => void {
  const onError = (event: ErrorEvent) => {
    appLog.add({
      level: 'error',
      source: 'window',
      message: event.message || 'script error',
      code: 'error',
    });
  };
  const onRejection = (event: Event) => {
    const reason = (event as Event & { reason?: unknown }).reason;
    appLog.add({
      level: 'error',
      source: 'window',
      message: describeValue(reason),
      code: 'unhandledrejection',
    });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * Feeds the app log from connection transitions, console warnings/errors and
 * uncaught errors. Everything is redacted on its way into the log.
 */
export function installDiagnosticsCapture(): () => void {
  const stops = [subscribeToConnection(), captureConsole(), captureWindowErrors()];
  return () => {
    for (const stop of stops) stop();
  };
}
