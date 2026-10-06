import { REDACTED } from '@droidmobile/daemon-client';
import type { LogBuffer } from './logBuffer';

export interface ReportContext {
  generatedAt: string;
  appVersion: string;
  platform: string;
  sdkVersion: string;
  daemonVersion: string | null;
  protocolVersion: string | null;
  status: string;
  host: string | null;
  transport: string | null;
  lastAuthenticatedAt: string | null;
}

/** Host and transport of a daemon URL; path, query and userinfo never leave this function. */
export function describeEndpoint(url: string | null): { host: string; transport: string } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return { host: parsed.host, transport: parsed.protocol.replace(':', '') };
  } catch {
    return null;
  }
}

const UNKNOWN = 'unknown';

export function buildLogReport(log: LogBuffer, context: ReportContext): string {
  const entries = log.entries();
  const lines = [
    'Droid Mobile diagnostics (unofficial client)',
    `generated: ${context.generatedAt}`,
    `app version: ${context.appVersion}`,
    `platform: ${context.platform}`,
    `sdk version: ${context.sdkVersion}`,
    `daemon: ${context.host ?? UNKNOWN} (${context.transport ?? UNKNOWN})`,
    `daemon version: ${context.daemonVersion ?? UNKNOWN}`,
    `protocol version: ${context.protocolVersion ?? UNKNOWN}`,
    `connection status: ${context.status}`,
    `last authenticated: ${context.lastAuthenticatedAt ?? 'never'}`,
    `credentials: ${REDACTED} (API keys and tokens are never exported)`,
    '',
    entries.length === 0 ? 'events: none recorded' : `events: ${entries.length}`,
    ...entries.map(
      (entry) =>
        `${entry.at} ${entry.level.toUpperCase()} ${entry.source}${
          entry.code ? ` [${entry.code}]` : ''
        } ${entry.message}`,
    ),
    '',
  ];
  return log.scrub(lines.join('\n'));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function reportFileName(at: Date): string {
  const date = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
  const time = `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
  return `droid-mobile-logs-${date}-${time}.txt`;
}
