/**
 * @droidmobile/daemon-client — adapter over @factory/droid-sdk 0.9.1.
 *
 * The UI never imports the SDK directly; all daemon access goes through this
 * package (architecture.md 3.1). Pure TypeScript, no React.
 */
export { createDaemonConnection } from './connection';
export type {
  DaemonConnection,
  DaemonConnectionOptions,
  SessionSearchParams,
} from './connection';
export { SessionHandle } from './session-handle';
export type { SessionHost, StreamOptions } from './session-handle';
export type { SessionMessagesPage } from './paging';
export type { NormalizedEvent } from './normalize';
export { normalizeStreamEvent } from './normalize';
export { classifyJsonRpcError, classifyConnectFailure, extractVersionMismatch } from './classify';
export type { ErrorClassification, JsonRpcErrorShape } from './classify';
export {
  AuthError,
  ConnectionError,
  DaemonClientError,
  MethodUnavailableError,
  ProtocolError,
} from './errors';
export type { DaemonErrorKind, VersionMismatchWarning } from './errors';
export { probeDaemonIdentity, SDK_FACTORY_PROTOCOL_VERSION } from './probe';
export type { DaemonIdentity } from './probe';
export {
  CONNECTION_FAILURES_BEFORE_OFFLINE,
  INITIAL_CONNECTION_STATE,
  reduceConnectionState,
} from './status';
export type {
  ConnectionMachineEvent,
  ConnectionMachineState,
  ConnectionStatus,
} from './status';
export { backoffDelay, DEFAULT_BACKOFF } from './backoff';
export type { BackoffOptions } from './backoff';
export { redactSecrets, REDACTED } from './redact';
