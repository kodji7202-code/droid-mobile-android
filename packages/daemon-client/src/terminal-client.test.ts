import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTerminalClient, parseTerminalFrame } from './terminal-client';
import type { LowLevelTerminalClient } from './terminal-client';

function frame(notification: Record<string, unknown>, sessionId = 's1'): string {
  return JSON.stringify({
    type: 'notification',
    method: 'daemon.session_notification',
    params: { sessionId, notification },
  });
}

interface FakeLow extends LowLevelTerminalClient {
  emit(raw: string): void;
  drop(): void;
  calls: Array<[string, unknown]>;
}

function fakeLow(overrides: Partial<LowLevelTerminalClient> = {}): FakeLow {
  let onMessage: (raw: string) => void = () => undefined;
  let onClose: (code: number, reason: string) => void = () => undefined;
  const calls: Array<[string, unknown]> = [];
  const low: FakeLow = {
    calls,
    emit: (raw) => onMessage(raw),
    drop: () => onClose(1006, 'gone'),
    connect: async (url) => void calls.push(['connect', url]),
    disconnect: () => void calls.push(['disconnect', null]),
    onMessage: (h) => void (onMessage = h),
    onConnectionClose: (h) => void (onClose = h),
    authenticate: async (p) => void calls.push(['authenticate', p.caller]),
    createTerminal: async (p) => (calls.push(['create', p]), { success: true as const }),
    writeTerminalData: async (p) => (calls.push(['write', p]), { success: true }),
    resizeTerminal: async (p) => (calls.push(['resize', p]), { success: true }),
    closeTerminal: async (p) => (calls.push(['close', p]), { success: true }),
    listTerminals: async () => ({
      terminals: [
        {
          id: 't1',
          pid: 7,
          cols: 80,
          rows: 24,
          state: { serialized: 'hello', plainText: 'hello', cols: 80, rows: 24, timestamp: 1 },
        },
      ],
    }),
    ...overrides,
  };
  return low;
}

afterEach(() => vi.useRealTimers());

describe('parseTerminalFrame', () => {
  it('parses data and exit notifications and ignores everything else', () => {
    expect(
      parseTerminalFrame(frame({ type: 'daemon.terminal_data', terminalId: 't1', data: 'x' })),
    ).toEqual({ type: 'data', sessionId: 's1', terminalId: 't1', data: 'x' });
    expect(
      parseTerminalFrame(
        frame({ type: 'daemon.terminal_exit', terminalId: 't1', exitCode: 3, signal: 'SIGTERM' }),
      ),
    ).toEqual({ type: 'exit', sessionId: 's1', terminalId: 't1', exitCode: 3, signal: 'SIGTERM' });
    expect(parseTerminalFrame('not json')).toBeNull();
    expect(parseTerminalFrame(frame({ type: 'other', terminalId: 't1' }))).toBeNull();
    expect(parseTerminalFrame(JSON.stringify({ method: 'daemon.connection_status' }))).toBeNull();
  });
});

describe('createTerminalClient', () => {
  it('connects, authenticates and forwards terminal events in order', async () => {
    const low = fakeLow();
    const client = createTerminalClient({
      url: 'ws://x',
      apiKey: 'fk-abc',
      createLowLevel: () => low,
    });
    const events: string[] = [];
    client.onEvent((e) => events.push(e.type === 'data' ? e.data : `exit${e.exitCode}`));
    await client.connect();
    expect(client.status).toBe('ready');
    expect(low.calls.map((c) => c[0])).toEqual(['connect', 'authenticate']);
    low.emit(frame({ type: 'daemon.terminal_data', terminalId: 't1', data: 'a' }));
    low.emit(frame({ type: 'daemon.terminal_data', terminalId: 't1', data: 'b' }));
    low.emit(frame({ type: 'daemon.terminal_exit', terminalId: 't1', exitCode: 0, signal: null }));
    expect(events).toEqual(['a', 'b', 'exit0']);
  });

  it('maps list results and rejects create failures', async () => {
    const low = fakeLow({
      createTerminal: async () => ({ success: false as const, error: 'bad_cwd' }),
    });
    const client = createTerminalClient({ url: 'ws://x', apiKey: 'k', createLowLevel: () => low });
    await client.connect();
    const [t] = await client.list('s1');
    expect(t).toMatchObject({ id: 't1', state: { serialized: 'hello', cols: 80 } });
    await expect(client.create('s1', { terminalId: 't2', cols: 80, rows: 24 })).rejects.toThrow(
      /bad_cwd/,
    );
  });

  it('refuses requests before it is ready', async () => {
    const client = createTerminalClient({
      url: 'ws://x',
      apiKey: 'k',
      createLowLevel: () => fakeLow(),
    });
    await expect(client.write('s1', 't1', 'x')).rejects.toThrow(/not ready/);
  });

  it('reconnects after a drop with a fresh socket and announces ready again', async () => {
    vi.useFakeTimers();
    const lows: FakeLow[] = [];
    const client = createTerminalClient({
      url: 'ws://x',
      apiKey: 'k',
      backoff: { initialMs: 10, jitterFraction: 0 },
      createLowLevel: () => {
        const l = fakeLow();
        lows.push(l);
        return l;
      },
    });
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    await client.connect();
    lows[0]!.drop();
    expect(client.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(20);
    expect(client.status).toBe('ready');
    expect(lows).toHaveLength(2);
    expect(statuses).toEqual(['connecting', 'ready', 'reconnecting', 'ready']);
    // Frames from the dead socket no longer reach listeners.
    const seen: unknown[] = [];
    client.onEvent((e) => seen.push(e));
    lows[0]!.emit(frame({ type: 'daemon.terminal_data', terminalId: 't1', data: 'stale' }));
    expect(seen).toEqual([]);
  });

  it('dispose stops reconnecting and closes the socket', async () => {
    vi.useFakeTimers();
    const lows: FakeLow[] = [];
    const client = createTerminalClient({
      url: 'ws://x',
      apiKey: 'k',
      backoff: { initialMs: 10, jitterFraction: 0 },
      createLowLevel: () => {
        const l = fakeLow();
        lows.push(l);
        return l;
      },
    });
    await client.connect();
    lows[0]!.drop();
    client.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(lows).toHaveLength(1);
    expect(client.status).toBe('closed');
  });

  it('redacts credentials from transport errors', async () => {
    const low = fakeLow({
      writeTerminalData: async () => {
        throw new Error('boom apiKey=fk-super-secret-key-value');
      },
    });
    const client = createTerminalClient({ url: 'ws://x', apiKey: 'k', createLowLevel: () => low });
    await client.connect();
    await expect(client.write('s1', 't1', 'x')).rejects.not.toThrow(/fk-super-secret/);
  });
});
