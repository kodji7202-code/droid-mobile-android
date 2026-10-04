import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeSession {
  id: string;
  settings: undefined;
  cwd: string;
  stream: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface FakeDroid {
  disconnect: ReturnType<typeof vi.fn>;
  sessions: {
    list: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

interface ConnectOptions {
  onError?: (err: unknown) => void;
}

const sdk = vi.hoisted(() => ({
  connectToDaemon: vi.fn(),
}));

vi.mock('@factory/droid-sdk', () => ({ connectToDaemon: sdk.connectToDaemon }));

import { createDaemonConnection } from './connection';

function fakeSession(id = 's1'): FakeSession {
  return {
    id,
    settings: undefined,
    cwd: '/work',
    stream: vi.fn(),
    interrupt: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeDroid(session: FakeSession = fakeSession()): FakeDroid {
  return {
    disconnect: vi.fn(),
    sessions: {
      list: vi.fn().mockResolvedValue([]),
      resume: vi.fn().mockResolvedValue(session),
      create: vi.fn().mockResolvedValue(session),
    },
  };
}

function newConnection(extra: { keepAliveMs?: number } = {}) {
  return createDaemonConnection({
    url: 'ws://127.0.0.1:1',
    apiKey: 'fk-test',
    backoff: { initialMs: 1, maxMs: 2, jitterFraction: 0 },
    keepAliveMs: 0,
    ...extra,
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 15));
}

beforeEach(() => {
  sdk.connectToDaemon.mockReset();
});

describe('disconnect during pending authentication', () => {
  it('never adopts the abandoned facade, never becomes ready and starts no keep-alive', async () => {
    const pending = deferred<FakeDroid>();
    sdk.connectToDaemon.mockReturnValueOnce(pending.promise);
    const connection = newConnection({ keepAliveMs: 5 });
    const statuses: string[] = [];
    connection.onStatus((s) => statuses.push(s));

    const connecting = connection.connect();
    const settled = connecting.then(
      () => 'resolved',
      () => 'rejected',
    );
    connection.disconnect();
    const droid = fakeDroid();
    pending.resolve(droid);

    expect(await settled).toBe('rejected');
    await flush();
    expect(statuses).not.toContain('ready');
    expect(connection.getStatus()).not.toBe('ready');
    expect(droid.disconnect).toHaveBeenCalled();
    expect(droid.sessions.list).not.toHaveBeenCalled();
  });

  it('does not emit ready when disconnect lands during the session rebind', async () => {
    const first = fakeDroid();
    const second = fakeDroid();
    const seen: ConnectOptions[] = [];
    sdk.connectToDaemon.mockImplementationOnce((opts: ConnectOptions) => {
      seen.push(opts);
      return Promise.resolve(first);
    });
    sdk.connectToDaemon.mockImplementationOnce((opts: ConnectOptions) => {
      seen.push(opts);
      return Promise.resolve(second);
    });
    const connection = newConnection();
    await connection.connect();
    await connection.createSession({} as never);

    const resumeGate = deferred<FakeSession>();
    second.sessions.resume.mockReturnValueOnce(resumeGate.promise);
    first.sessions.list.mockRejectedValue(new Error('down'));
    const statuses: string[] = [];
    connection.onStatus((s) => statuses.push(s));
    seen[0]!.onError?.(new Error('x'));
    await vi.waitFor(() => expect(second.sessions.resume).toHaveBeenCalled());

    connection.disconnect();
    resumeGate.resolve(fakeSession());
    await flush();

    expect(statuses.slice(statuses.lastIndexOf('reconnecting') + 1)).not.toContain('ready');
    expect(connection.getStatus()).not.toBe('ready');
    expect(second.disconnect).toHaveBeenCalled();
  });
});
describe('liveness probe fencing', () => {
  it('a late failing probe of the old facade does not tear down its healthy replacement', async () => {
    const a = fakeDroid();
    const b = fakeDroid();
    const optionsSeen: ConnectOptions[] = [];
    sdk.connectToDaemon.mockImplementationOnce((opts: ConnectOptions) => {
      optionsSeen.push(opts);
      return Promise.resolve(a);
    });
    sdk.connectToDaemon.mockImplementationOnce((opts: ConnectOptions) => {
      optionsSeen.push(opts);
      return Promise.resolve(b);
    });
    const connection = newConnection();
    await connection.connect();

    const slow = deferred<never>();
    a.sessions.list.mockReturnValueOnce(slow.promise);
    a.sessions.list.mockRejectedValueOnce(new Error('socket gone'));
    optionsSeen[0]!.onError?.(new Error('e1'));
    optionsSeen[0]!.onError?.(new Error('e2'));

    await vi.waitFor(() => {
      expect(sdk.connectToDaemon).toHaveBeenCalledTimes(2);
      expect(connection.getStatus()).toBe('ready');
    });
    slow.reject(new Error('late failure'));
    await flush();

    expect(b.disconnect).not.toHaveBeenCalled();
    expect(connection.getStatus()).toBe('ready');
  });
});

describe('cancelled streams', () => {
  it('an aborted stream is not a transport failure and leaves the session usable without re-resume', async () => {
    const session = fakeSession();
    const droid = fakeDroid(session);
    sdk.connectToDaemon.mockResolvedValueOnce(droid);
    const connection = newConnection();
    await connection.connect();
    const handle = await connection.createSession({} as never);

    const controller = new AbortController();
    controller.abort();
    session.stream.mockImplementation(async function* () {
      yield* [];
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(
      (async () => {
        for await (const _ of handle.stream('hi', { abortSignal: controller.signal })) void _;
      })(),
    ).rejects.toMatchObject({ name: 'DaemonClientError', kind: 'unknown' });
    await flush();

    await handle.interrupt();
    expect(droid.sessions.resume).not.toHaveBeenCalled();
    expect(session.interrupt).toHaveBeenCalledTimes(1);
    expect(connection.getStatus()).toBe('ready');
  });

  it('redacts credentials carried by an application stream error and never rethrows the raw SDK error', async () => {
    const session = fakeSession();
    const droid = fakeDroid(session);
    sdk.connectToDaemon.mockResolvedValueOnce(droid);
    const connection = newConnection();
    await connection.connect();
    const handle = await connection.createSession({} as never);

    const raw = Object.assign(new Error('rejected apiKey: "abc def ghi" Authorization: Basic dXNlcjpwYXNz'), {
      name: 'SessionError',
      data: { token: 'zzz' },
    });
    session.stream.mockImplementation(async function* () {
      yield* [];
      throw raw;
    });
    const caught = await (async () => {
      try {
        for await (const _ of handle.stream('hi')) void _;
      } catch (err) {
        return err;
      }
      return undefined;
    })();
    expect(caught).not.toBe(raw);
    expect((caught as Error).message).not.toMatch(/abc|def ghi|dXNlcjpwYXNz/);
    expect(JSON.stringify(caught)).not.toContain('zzz');
  });

  it('the replacement-in-progress guard is an application error that keeps the healthy session attached', async () => {
    const session = fakeSession();
    const droid = fakeDroid(session);
    sdk.connectToDaemon.mockResolvedValueOnce(droid);
    const connection = newConnection();
    await connection.connect();
    const handle = await connection.createSession({} as never);

    const gate = deferred<never>();
    session.interrupt.mockReturnValueOnce(gate.promise);
    const guard = Object.assign(new Error('Session replacement is already in progress.'), {
      name: 'ConnectionError',
    });
    const pending = handle.interrupt();
    gate.reject(guard);
    await expect(pending).rejects.toMatchObject({ kind: 'unknown' });
    await flush();

    await handle.interrupt();
    expect(session.detach).not.toHaveBeenCalled();
    expect(droid.sessions.resume).not.toHaveBeenCalled();
    expect(session.interrupt).toHaveBeenCalledTimes(2);
    expect(connection.getStatus()).toBe('ready');
  });
  it('detaches the stale SDK attachment before re-resuming after a real transport error', async () => {
    const stale = fakeSession();
    const fresh = fakeSession();
    const droid = fakeDroid(stale);
    droid.sessions.resume.mockImplementation(async () => {
      if (stale.detach.mock.calls.length === 0) throw new Error('session already attached');
      return fresh;
    });
    sdk.connectToDaemon.mockResolvedValueOnce(droid);
    const connection = newConnection();
    await connection.connect();
    const handle = await connection.createSession({} as never);

    stale.interrupt.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(handle.interrupt()).rejects.toMatchObject({ kind: 'connection' });
    await flush();
    await handle.interrupt();

    expect(stale.detach).toHaveBeenCalled();
    expect(fresh.interrupt).toHaveBeenCalledTimes(1);
  });
});

describe('session errors share the connection warning mapper', () => {
  it('emits an advisory warning for a version error and keeps the connection and attachment', async () => {
    const session = fakeSession();
    const droid = fakeDroid(session);
    sdk.connectToDaemon.mockResolvedValueOnce(droid);
    const connection = newConnection();
    await connection.connect();
    const handle = await connection.createSession({} as never);
    const warnings: unknown[] = [];
    connection.onWarning((w) => warnings.push(w));

    session.interrupt.mockRejectedValueOnce({
      code: -32601,
      message: 'Method not found',
      data: {
        protocolVersionMismatch: {
          localFactoryProtocolVersion: '1.0.0',
          peerFactoryProtocolVersion: '2.0.0',
          method: 'droid.interrupt_session',
        },
      },
    });
    await expect(handle.interrupt()).rejects.toBeDefined();
    await flush();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ peerFactoryProtocolVersion: '2.0.0' });
    expect(connection.getStatus()).toBe('ready');
    await handle.interrupt();
    expect(droid.sessions.resume).not.toHaveBeenCalled();
    expect(droid.sessions.list).not.toHaveBeenCalled();
  });
});
