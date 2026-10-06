import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeDaemonIdentity } from './probe';

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.last = this;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: data === undefined ? undefined : JSON.stringify(data) });
    }
  }
}

function authenticateReply(id: string): unknown {
  return {
    type: 'response',
    id,
    factoryProtocolVersion: '1.244.0',
    result: { userId: 'user-1', orgId: 'org-1' },
  };
}

function requestId(socket: FakeWebSocket): string {
  return (JSON.parse(socket.sent[0] ?? '{}') as { id: string }).id;
}

describe('probeDaemonIdentity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.last = null;
  });

  it('reads the daemon version from the connection status notification that follows authenticate', async () => {
    const pending = probeDaemonIdentity('ws://daemon.test', 'fk-test-key');
    const socket = FakeWebSocket.last!;
    socket.emit('open');
    socket.emit('message', authenticateReply(requestId(socket)));
    socket.emit('message', {
      type: 'notification',
      method: 'daemon.connection_status',
      params: { droidCLIVersion: '0.232.0', platform: 'win32' },
    });
    await expect(pending).resolves.toEqual({
      userId: 'user-1',
      orgId: 'org-1',
      daemonProtocolVersion: '1.244.0',
      daemonVersion: '0.232.0',
    });
    expect(socket.closed).toBe(true);
  });

  it('resolves without a daemon version when the notification never arrives', async () => {
    const pending = probeDaemonIdentity('ws://daemon.test', 'fk-test-key');
    const socket = FakeWebSocket.last!;
    socket.emit('open');
    socket.emit('message', authenticateReply(requestId(socket)));
    await vi.advanceTimersByTimeAsync(3_000);
    const identity = await pending;
    expect(identity.daemonProtocolVersion).toBe('1.244.0');
    expect(identity.daemonVersion).toBeUndefined();
    expect(socket.closed).toBe(true);
  });

  it('ignores a notification whose version is not a string', async () => {
    const pending = probeDaemonIdentity('ws://daemon.test', 'fk-test-key');
    const socket = FakeWebSocket.last!;
    socket.emit('open');
    socket.emit('message', authenticateReply(requestId(socket)));
    socket.emit('message', {
      type: 'notification',
      method: 'daemon.connection_status',
      params: { droidCLIVersion: 232 },
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).daemonVersion).toBeUndefined();
  });
});
