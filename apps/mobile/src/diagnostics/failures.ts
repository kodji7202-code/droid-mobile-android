import { appLog } from './logBuffer';

export function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Logs a failed operation; the error kind (or name) becomes the code, the message is redacted by the log. */
export function logFailure(source: string, error: unknown): void {
  const kind = (error as { kind?: unknown } | null)?.kind;
  const code = typeof kind === 'string' ? kind : error instanceof Error ? error.name : 'unknown';
  appLog.add({ level: 'error', source, message: describeValue(error), code });
}
