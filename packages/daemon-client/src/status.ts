/**
 * Connection status state machine (architecture.md 3.1). Pure reducer; the
 * connection owns the side effects (retries, listeners).
 *
 * Status meanings:
 * - connecting: WebSocket dial in progress (first attempt)
 * - authenticating: dial done, `daemon.authenticate` handshake in progress
 * - ready: authenticated and usable
 * - reconnecting: connection was ready before; an automatic reconnect loop is running
 * - offline: not connected; idle or waiting (initial state, initial failure, or repeated reconnect failures)
 * - error: non-recoverable failure (e.g. the API key was rejected)
 */
export type ConnectionStatus =
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'reconnecting'
  | 'offline'
  | 'error';

/** Consecutive failed reconnect attempts after which the status degrades to offline. */
export const CONNECTION_FAILURES_BEFORE_OFFLINE = 5;

export interface ConnectionMachineState {
  status: ConnectionStatus;
  /** True once the connection has reached ready at least once. */
  everReady: boolean;
  consecutiveFailures: number;
}

export type ConnectionMachineEvent =
  | { type: 'attempt-start' }
  | { type: 'auth-start' }
  | { type: 'ready' }
  | { type: 'transport-lost' }
  | { type: 'attempt-failed'; failureKind: 'auth' | 'transient' }
  | { type: 'disconnected' };

/**
 * State before any attempt: the connection exists but connect() has not been
 * called yet, so nothing is dialling.
 */
export const INITIAL_CONNECTION_STATE: ConnectionMachineState = {
  status: 'offline',
  everReady: false,
  consecutiveFailures: 0,
};

export function reduceConnectionState(
  state: ConnectionMachineState,
  event: ConnectionMachineEvent,
): ConnectionMachineState {
  switch (event.type) {
    case 'attempt-start':
      return {
        ...state,
        status: state.everReady ? 'reconnecting' : 'connecting',
      };
    case 'auth-start':
      return state.status === 'connecting' ? { ...state, status: 'authenticating' } : state;
    case 'ready':
      return { status: 'ready', everReady: true, consecutiveFailures: 0 };
    case 'transport-lost':
      return state.everReady ? { ...state, status: 'reconnecting' } : state;
    case 'attempt-failed': {
      if (event.failureKind === 'auth') {
        return { ...state, status: 'error' };
      }
      const consecutiveFailures = state.consecutiveFailures + 1;
      const status =
        !state.everReady || consecutiveFailures >= CONNECTION_FAILURES_BEFORE_OFFLINE
          ? 'offline'
          : 'reconnecting';
      return { ...state, status, consecutiveFailures };
    }
    case 'disconnected':
      return { ...state, status: 'offline' };
  }
}
