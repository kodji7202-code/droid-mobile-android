/**
 * Error classification for daemon RPC failures and connect-phase failures.
 *
 * Verified daemon behaviour (validation-contract.md, wrong-key behaviour and
 * VAL-ONBOARD-036): a wrong API key makes `daemon.authenticate` fail with
 * JSON-RPC -32001 and the generic message "Internal error"; a frame sent with
 * a mismatched factoryProtocolVersion fails with -32601 and
 * `error.data.protocolVersionMismatch`. The classifier maps the former to a
 * key-specific AuthError and the latter to a non-blocking version warning.
 */
import {
  AuthError,
  ConnectionError,
  DaemonClientError,
  MethodUnavailableError,
  ProtocolError,
} from './errors';
import type { VersionMismatchWarning } from './errors';

/** JSON-RPC error codes observed from the daemon. */
export const RPC_AUTH_REJECTED = -32001 as const;
export const RPC_METHOD_NOT_FOUND = -32601 as const;
export const RPC_PARSE_ERROR = -32700 as const;
export const RPC_INVALID_PARAMS = -32602 as const;

/** Wire shape of a JSON-RPC error object. */
export interface JsonRpcErrorShape {
  code: number;
  message?: string;
  data?: unknown;
}

export type ErrorClassification =
  | { kind: 'version-warning'; warning: VersionMismatchWarning }
  | { kind: 'auth'; error: AuthError }
  | { kind: 'connection'; error: ConnectionError }
  | { kind: 'protocol'; error: ProtocolError }
  | { kind: 'method-unavailable'; error: MethodUnavailableError }
  | { kind: 'unknown'; error: DaemonClientError };

interface VersionMismatchData {
  localFactoryProtocolVersion?: unknown;
  peerFactoryProtocolVersion?: unknown;
  messageType?: unknown;
  method?: unknown;
  requestId?: unknown;
}

function asVersionMismatch(value: unknown): VersionMismatchWarning | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as VersionMismatchData;
  if (
    typeof candidate.localFactoryProtocolVersion === 'string' &&
    typeof candidate.peerFactoryProtocolVersion === 'string'
  ) {
    return {
      localFactoryProtocolVersion: candidate.localFactoryProtocolVersion,
      peerFactoryProtocolVersion: candidate.peerFactoryProtocolVersion,
      method: typeof candidate.method === 'string' ? candidate.method : undefined,
      messageType: typeof candidate.messageType === 'string' ? candidate.messageType : undefined,
      requestId: typeof candidate.requestId === 'string' ? candidate.requestId : undefined,
    };
  }
  return null;
}

/** Extracts a version-mismatch warning from `error.data` (or data itself). */
export function extractVersionMismatch(data: unknown): VersionMismatchWarning | null {
  if (typeof data !== 'object' || data === null) return null;
  const nested = (data as { protocolVersionMismatch?: unknown }).protocolVersionMismatch;
  return asVersionMismatch(nested) ?? asVersionMismatch(data);
}

/**
 * Classifies a JSON-RPC error object from the daemon.
 * Auth (key) rejections win over version-mismatch data: a wrong-key
 * authenticate can carry the same protocolVersionMismatch data and must still
 * be an AuthError (VAL-ONBOARD-036).
 *
 * `fallbackMethod` is the request method from the originating frame, used
 * when the mismatch data carries no method of its own.
 */
export function classifyJsonRpcError(rpc: JsonRpcErrorShape, fallbackMethod?: string): ErrorClassification {
  if (rpc.code === RPC_AUTH_REJECTED) {
    return { kind: 'auth', error: new AuthError(undefined, { cause: rpc }) };
  }
  const mismatch = extractVersionMismatch(rpc.data);
  if (mismatch) {
    return { kind: 'version-warning', warning: { ...mismatch, method: mismatch.method ?? fallbackMethod } };
  }
  if (rpc.code === RPC_METHOD_NOT_FOUND) {
    return { kind: 'method-unavailable', error: new MethodUnavailableError(rpc.message ?? 'The daemon does not implement this method.', { cause: rpc }) };
  }
  if (rpc.code === RPC_PARSE_ERROR || rpc.code === RPC_INVALID_PARAMS) {
    return { kind: 'protocol', error: new ProtocolError(rpc.message ?? 'The daemon sent a malformed response.', { cause: rpc }) };
  }
  return {
    kind: 'unknown',
    error: new DaemonClientError('unknown', rpc.message ?? `The daemon request failed (code ${rpc.code}).`, { cause: rpc }),
  };
}

/** True when the error looks like the SDK's ConnectionFailureError for a rejected key. */
function isAuthRejectedFailure(err: object): boolean {
  const reason = (err as { reason?: unknown }).reason;
  return reason === 'auth_rejected';
}

interface WithError {
  error?: unknown;
}

function asJsonRpcError(value: unknown): JsonRpcErrorShape | null {
  if (typeof value !== 'object' || value === null) return null;
  const direct = value as Partial<JsonRpcErrorShape>;
  if (typeof direct.code === 'number') {
    return { code: direct.code, message: direct.message, data: direct.data };
  }
  // SDK JsonRpcRequestError carries the rpc error under `.error`.
  const nested = (value as WithError).error;
  if (typeof nested === 'object' && nested !== null && typeof (nested as Partial<JsonRpcErrorShape>).code === 'number') {
    const n = nested as JsonRpcErrorShape;
    return { code: n.code, message: n.message, data: n.data };
  }
  return null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown connection failure';
  }
}

/** Follows `cause`/`originalError` links to surface the first JSON-RPC error. */
function findRpcError(err: unknown, depth = 0): JsonRpcErrorShape | null {
  if (depth > 5 || typeof err !== 'object' || err === null) return null;
  const rpc = asJsonRpcError(err);
  if (rpc) return rpc;
  const cause = (err as { cause?: unknown; originalError?: unknown });
  return findRpcError(cause.originalError, depth + 1) ?? findRpcError(cause.cause, depth + 1);
}

/**
 * Classifies a failure thrown by the SDK during connect (or carried in an
 * onError event) into the adapter's typed errors. Anything that is not an
 * auth rejection is a failure to reach or complete the daemon handshake:
 * ConnectionError.
 */
export function classifyConnectFailure(err: unknown): DaemonClientError {
  if (err instanceof DaemonClientError) return err;
  const rpc = findRpcError(err);
  if (rpc) {
    const classified = classifyJsonRpcError(rpc);
    if (classified.kind !== 'version-warning') return classified.error;
    // A version warning during connect is surfaced as a non-fatal connection
    // failure with the warning attached via its cause chain message.
    return new ConnectionError(
      'The daemon speaks a different protocol version than this client.',
      { cause: classified.warning },
    );
  }
  if (typeof err === 'object' && err !== null && isAuthRejectedFailure(err)) {
    return new AuthError(undefined, { cause: err });
  }
  return new ConnectionError(`Could not connect to the daemon: ${messageOf(err)}`, { cause: err });
}
