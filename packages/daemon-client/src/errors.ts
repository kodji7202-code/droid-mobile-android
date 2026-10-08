import { redactSecrets, redactValue } from './redact';

/**
 * Error taxonomy of the daemon-client adapter. Every
 * class redacts secret material from its message at construction time, so a
 * serialized error can never carry an API key (KEY-LEAK-SCAN count 0).
 */
export type DaemonErrorKind = 'auth' | 'connection' | 'protocol' | 'method-unavailable' | 'unknown';

function redactCause(cause: unknown): unknown {
  if (cause === undefined || cause === null) return cause;
  if (cause instanceof Error) {
    const copy = new Error(redactSecrets(cause.message));
    copy.name = cause.name;
    return copy;
  }
  if (typeof cause === 'string') return redactSecrets(cause);
  try {
    return JSON.stringify(redactValue(cause));
  } catch {
    return '[unserializable cause]';
  }
}

export class DaemonClientError extends Error {
  readonly kind: DaemonErrorKind;

  constructor(kind: DaemonErrorKind, message: string, options?: { cause?: unknown }) {
    super(
      redactSecrets(message),
      options === undefined ? undefined : { cause: redactCause(options.cause) },
    );
    this.name = 'DaemonClientError';
    this.kind = kind;
  }
}

/** The daemon rejected the API key. Message never repeats the daemon's generic text. */
export class AuthError extends DaemonClientError {
  constructor(
    message = 'The API key was rejected by the daemon. Check the key and try again.',
    options?: { cause?: unknown },
  ) {
    super('auth', message, options);
    this.name = 'AuthError';
  }
}

/** The daemon could not be reached or was not a daemon endpoint. */
export class ConnectionError extends DaemonClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('connection', message, options);
    this.name = 'ConnectionError';
  }
}

/** A malformed frame or protocol violation. */
export class ProtocolError extends DaemonClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('protocol', message, options);
    this.name = 'ProtocolError';
  }
}

/** The daemon does not implement the requested method. */
export class MethodUnavailableError extends DaemonClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('method-unavailable', message, options);
    this.name = 'MethodUnavailableError';
  }
}

/**
 * Non-blocking signal that the daemon speaks a different protocol version
 * than this SDK build (VAL-ONBOARD-036). Not an Error: it must never be
 * treated as fatal. Classified before method-unavailable/auth for -32601.
 */
export interface VersionMismatchWarning {
  localFactoryProtocolVersion: string;
  peerFactoryProtocolVersion: string;
  method?: string;
  messageType?: string;
  requestId?: string;
}
