import { REDACTED, redactSecrets } from '@droidmobile/daemon-client';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  /** ISO-8601 timestamp. */
  at: string;
  level: LogLevel;
  source: string;
  message: string;
  /** Machine-readable status or error kind (for example `auth`, `reconnecting`). */
  code?: string;
}

export interface LogBuffer {
  add(entry: Omit<LogEntry, 'at'>): void;
  entries(): LogEntry[];
  clear(): void;
  /**
   * Registers a credential of unknowable format (a custom model key, the API
   * key) so it is replaced wherever it appears, before and after it was logged.
   */
  registerSecret(secret: string): void;
  /** Redacts pattern-matched and registered secrets from free text. */
  scrub(text: string): string;
  subscribe(listener: () => void): () => void;
}

const DEFAULT_CAPACITY = 500;
const MAX_MESSAGE_LENGTH = 1000;
/** Shorter strings would blank out ordinary words when scrubbed. */
const MIN_SECRET_LENGTH = 8;

export function createLogBuffer(options: { capacity?: number; now?: () => Date } = {}): LogBuffer {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const now = options.now ?? (() => new Date());
  const secrets = new Set<string>();
  const listeners = new Set<() => void>();
  let items: LogEntry[] = [];

  function scrub(text: string): string {
    // The shared redactor keeps the scheme word (`Bearer [REDACTED]`); a diagnostics file carries no `Bearer ` at all.
    let result = redactSecrets(text).replace(/\bBearer\s+\S+/gi, REDACTED);
    for (const secret of secrets) result = result.split(secret).join(REDACTED);
    return result;
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    add(entry) {
      const message = scrub(entry.message).slice(0, MAX_MESSAGE_LENGTH);
      const stored: LogEntry = {
        at: now().toISOString(),
        level: entry.level,
        source: entry.source,
        message,
        ...(entry.code === undefined ? {} : { code: scrub(entry.code) }),
      };
      items = [...items, stored].slice(-capacity);
      notify();
    },
    // Entries scrubbed again on read so a secret registered after logging is still removed.
    entries: () => items.map((entry) => ({ ...entry, message: scrub(entry.message) })),
    clear() {
      items = [];
      notify();
    },
    registerSecret(secret) {
      if (secret.length >= MIN_SECRET_LENGTH) secrets.add(secret);
    },
    scrub,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app-wide log shown and exported in Settings > About and diagnostics. */
export const appLog: LogBuffer = createLogBuffer();
