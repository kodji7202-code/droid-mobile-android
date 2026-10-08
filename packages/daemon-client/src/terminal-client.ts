/**
 * Sidecar terminal client. The SDK facade swallows `daemon.terminal_data` and
 * `daemon.terminal_exit`, so terminals use their own low-level connection
 *: `createWebSocketDaemonClient` + `onMessage`.
 *
 * A terminal belongs to the connection that created it; after the owner
 * disconnects the shell keeps running and a NEW connection's `list` returns it
 * with its serialized state. This client therefore reconnects on its own and
 * announces every `ready` so the owner can re-list.
 */
import type { createWebSocketDaemonClient } from '@factory/droid-sdk';
import { loadSdk } from './sdk';
import { backoffDelay, DEFAULT_BACKOFF } from './backoff';
import type { BackoffOptions } from './backoff';
import { classifyConnectFailure } from './classify';
import { ConnectionError } from './errors';
import { redactSecrets } from './redact';

export interface TerminalState {
  serialized: string;
  plainText: string;
  cols: number;
  rows: number;
}

export interface TerminalInfo {
  id: string;
  pid: number | null;
  cols: number;
  rows: number;
  state?: TerminalState;
}

export type TerminalEvent =
  | { type: 'data'; sessionId: string; terminalId: string; data: string }
  | {
      type: 'exit';
      sessionId: string;
      terminalId: string;
      exitCode: number | null;
      signal: string | null;
    };

export type TerminalLinkStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed';

export interface CreateTerminalParams {
  terminalId: string;
  cols: number;
  rows: number;
  cwd?: string;
}

export interface TerminalClient {
  readonly status: TerminalLinkStatus;
  /** Resolves once authenticated; rejects with the classified error if the first attempt fails. */
  connect(): Promise<void>;
  onStatus(listener: (status: TerminalLinkStatus) => void): () => void;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
  create(sessionId: string, params: CreateTerminalParams): Promise<void>;
  write(sessionId: string, terminalId: string, data: string): Promise<boolean>;
  resize(sessionId: string, terminalId: string, cols: number, rows: number): Promise<boolean>;
  close(sessionId: string, terminalId: string): Promise<boolean>;
  list(sessionId: string): Promise<TerminalInfo[]>;
  /** Drops the socket and stops reconnecting. Running shells are left alone. */
  dispose(): void;
}

/** The slice of the SDK's DaemonClient used here; injectable for unit tests. */
export interface LowLevelTerminalClient {
  connect(url: string): Promise<void>;
  disconnect(): void;
  onMessage(handler: (raw: string) => void): void;
  onConnectionClose(handler: (code: number, reason: string) => void): void;
  authenticate(params: { apiKey: string; caller: string }): Promise<unknown>;
  createTerminal(params: {
    sessionId: string;
    terminalId: string;
    cols?: number;
    rows?: number;
    cwd?: string;
  }): Promise<{ success: true } | { success: false; error: string }>;
  writeTerminalData(params: {
    sessionId: string;
    terminalId: string;
    data: string;
  }): Promise<{ success: boolean }>;
  resizeTerminal(params: {
    sessionId: string;
    terminalId: string;
    cols: number;
    rows: number;
  }): Promise<{ success: boolean }>;
  closeTerminal(params: { sessionId: string; terminalId: string }): Promise<{ success: boolean }>;
  listTerminals(params: { sessionId: string }): Promise<{
    terminals: Array<{
      id: string;
      pid: number | null;
      cols: number;
      rows: number;
      state?: TerminalState & { timestamp?: unknown };
    }>;
  }>;
}

export interface TerminalClientOptions {
  url: string;
  apiKey: string;
  backoff?: Partial<BackoffOptions>;
  /** Test seam; defaults to the SDK's WebSocket client. */
  createLowLevel?: () => LowLevelTerminalClient | Promise<LowLevelTerminalClient>;
}

const CALLER = 'droid-mobile-terminals';

/** Parses one raw frame; non-terminal frames yield null. */
export function parseTerminalFrame(raw: string): TerminalEvent | null {
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return null;
  }
  const f = frame as {
    method?: unknown;
    params?: { sessionId?: unknown; notification?: Record<string, unknown> };
  };
  if (f.method !== 'daemon.session_notification') return null;
  const n = f.params?.notification;
  if (!n || typeof n.terminalId !== 'string') return null;
  const sessionId = typeof f.params?.sessionId === 'string' ? f.params.sessionId : '';
  if (n.type === 'daemon.terminal_data' && typeof n.data === 'string') {
    return { type: 'data', sessionId, terminalId: n.terminalId, data: n.data };
  }
  if (n.type === 'daemon.terminal_exit') {
    return {
      type: 'exit',
      sessionId,
      terminalId: n.terminalId,
      exitCode: typeof n.exitCode === 'number' ? n.exitCode : null,
      signal: typeof n.signal === 'string' ? n.signal : null,
    };
  }
  return null;
}

export function createTerminalClient(options: TerminalClientOptions): TerminalClient {
  const backoff: BackoffOptions = { ...DEFAULT_BACKOFF, ...options.backoff };
  const statusListeners = new Set<(s: TerminalLinkStatus) => void>();
  const eventListeners = new Set<(e: TerminalEvent) => void>();
  const makeLowLevel =
    options.createLowLevel ??
    (async (): Promise<LowLevelTerminalClient> => {
      const { createWebSocketDaemonClient: create } = await loadSdk();
      return create({
        machineType: 'local' as Parameters<typeof createWebSocketDaemonClient>[0]['machineType'],
      }) as unknown as LowLevelTerminalClient;
    });

  let status: TerminalLinkStatus = 'idle';
  let low: LowLevelTerminalClient | null = null;
  let generation = 0;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let connecting: Promise<void> | null = null;

  const setStatus = (next: TerminalLinkStatus): void => {
    if (status === next) return;
    status = next;
    for (const l of [...statusListeners]) l(next);
  };

  /** All dials go through here so at most one is ever in flight. */
  function startDial(): Promise<void> {
    if (connecting) return connecting;
    const run: Promise<void> = dial().finally(() => {
      if (connecting === run) connecting = null;
    });
    connecting = run;
    return run;
  }

  async function dial(): Promise<void> {
    const mine = ++generation;
    const replaced = low;
    if (replaced) {
      try {
        replaced.disconnect();
      } catch {
        // already closed
      }
    }
    let client: LowLevelTerminalClient;
    try {
      client = await makeLowLevel();
    } catch (err) {
      throw classifyConnectFailure(err);
    }
    if (mine !== generation || disposed) {
      try {
        client.disconnect();
      } catch {
        // superseded attempt
      }
      throw new ConnectionError('The terminal connection was closed.');
    }
    low = client;
    // The SDK retries a failing connect on its own and reports a close for every failed
    // try, so a close only means the link dropped once this dial has authenticated.
    let established = false;
    client.onMessage((raw) => {
      if (mine !== generation) return;
      const event = parseTerminalFrame(raw);
      if (event) for (const l of [...eventListeners]) l(event);
    });
    client.onConnectionClose(() => {
      if (mine !== generation || disposed || !established) return;
      low = null;
      scheduleReconnect();
    });
    try {
      await client.connect(options.url);
      await client.authenticate({ apiKey: options.apiKey, caller: CALLER });
    } catch (err) {
      if (mine === generation) {
        low = null;
        try {
          client.disconnect();
        } catch {
          // already closed
        }
      }
      throw classifyConnectFailure(err);
    }
    if (mine !== generation || disposed) {
      try {
        client.disconnect();
      } catch {
        // superseded attempt
      }
      throw new ConnectionError('The terminal connection was closed.');
    }
    established = true;
    attempt = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    setStatus('ready');
  }

  function scheduleReconnect(): void {
    if (disposed || retryTimer) return;
    setStatus('reconnecting');
    attempt += 1;
    retryTimer = setTimeout(
      () => {
        retryTimer = null;
        if (disposed) return;
        startDial().catch(() => {
          if (!disposed) scheduleReconnect();
        });
      },
      backoffDelay(attempt, backoff),
    );
  }

  const requireLow = (): LowLevelTerminalClient => {
    if (!low || status !== 'ready')
      throw new ConnectionError('The terminal connection is not ready.');
    return low;
  };

  const guard = async <T>(run: (client: LowLevelTerminalClient) => Promise<T>): Promise<T> => {
    try {
      return await run(requireLow());
    } catch (err) {
      if (err instanceof ConnectionError) throw err;
      throw new ConnectionError(redactSecrets(err instanceof Error ? err.message : String(err)));
    }
  };

  return {
    get status() {
      return status;
    },
    connect() {
      if (status === 'ready') return Promise.resolve();
      if (connecting) return connecting;
      const wasReconnecting = status === 'reconnecting';
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (!wasReconnecting) setStatus('connecting');
      return startDial().catch((err: unknown) => {
        if (disposed) throw err;
        if (wasReconnecting) scheduleReconnect();
        else setStatus('closed');
        throw err;
      });
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    create: (sessionId, params) =>
      guard(async (c) => {
        const result = await c.createTerminal({ sessionId, ...params });
        if (!result.success) {
          throw new ConnectionError(`The daemon could not create the terminal (${result.error}).`);
        }
      }),
    write: (sessionId, terminalId, data) =>
      guard(async (c) => (await c.writeTerminalData({ sessionId, terminalId, data })).success),
    resize: (sessionId, terminalId, cols, rows) =>
      guard(async (c) => (await c.resizeTerminal({ sessionId, terminalId, cols, rows })).success),
    close: (sessionId, terminalId) =>
      guard(async (c) => (await c.closeTerminal({ sessionId, terminalId })).success),
    list: (sessionId) =>
      guard(async (c) => {
        const { terminals } = await c.listTerminals({ sessionId });
        return terminals.map((t) => ({
          id: t.id,
          pid: t.pid,
          cols: t.cols,
          rows: t.rows,
          ...(t.state
            ? {
                state: {
                  serialized: t.state.serialized,
                  plainText: t.state.plainText,
                  cols: t.state.cols,
                  rows: t.state.rows,
                },
              }
            : {}),
        }));
      }),
    dispose() {
      disposed = true;
      generation += 1;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      const client = low;
      low = null;
      setStatus('closed');
      try {
        client?.disconnect();
      } catch {
        // already closed
      }
      statusListeners.clear();
      eventListeners.clear();
    },
  };
}
