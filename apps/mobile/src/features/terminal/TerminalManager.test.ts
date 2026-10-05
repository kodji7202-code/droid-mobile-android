import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeEmulator, FakeTerminalClient } from './fakes';
import { TerminalManager } from './TerminalManager';

function setup() {
  const client = new FakeTerminalClient();
  const emulators: FakeEmulator[] = [];
  let n = 0;
  const manager = new TerminalManager({
    client,
    newId: () => `t${++n}`,
    loadEmulatorFactory: async () => () => {
      const e = new FakeEmulator();
      emulators.push(e);
      return e;
    },
  });
  return { client, manager, emulators };
}

const data = (terminalId: string, text: string, sessionId = 's1') =>
  ({ type: 'data', sessionId, terminalId, data: text }) as const;
const exit = (terminalId: string, exitCode: number | null) =>
  ({ type: 'exit', sessionId: 's1', terminalId, exitCode, signal: 'SIGTERM' }) as const;

describe('TerminalManager', () => {
  it('creates exactly one terminal with the fitted size and session cwd', async () => {
    const { client, manager } = setup();
    const host = document.createElement('div');
    await Promise.all([
      manager.attach('s1', 'C:\\work', host),
      manager.attach('s1', 'C:\\work', host),
    ]);
    expect(client.count('create')).toBe(1);
    expect(client.frames.find((f) => f.op === 'create')).toMatchObject({
      sessionId: 's1',
      terminalId: 't1',
      cwd: 'C:\\work',
      cols: 100,
      rows: 30,
    });
    const view = manager.getSession('s1');
    expect(view.entries.map((e) => [e.id, e.status])).toEqual([['t1', 'running']]);
    expect(view.activeId).toBe('t1');
    await manager.attach('s1', 'C:\\work', host);
    expect(client.count('create')).toBe(1);
    expect(client.count('list')).toBe(1);
  });

  it('keeps terminals isolated and captures output of hidden ones', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    await manager.create('s1', 'C:\\w', null);
    expect(manager.getSession('s1').activeId).toBe('t2');
    client.emit(data('t1', 'AAA'));
    client.emit(data('t2', 'BBB'));
    client.emit(data('t1', 'line 1\r\n'));
    client.emit(data('t1', 'line 2\r\n'));
    expect(emulators[0]!.text).toBe('AAAline 1\r\nline 2\r\n');
    expect(emulators[1]!.text).toBe('BBB');
    manager.select('s1', 't1');
    expect(manager.getSession('s1').activeId).toBe('t1');
  });

  it('routes frames by the session the terminal was opened from', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\a', null);
    await manager.attach('s2', 'C:\\b', null);
    emulators[0]!.type('echo from-A\r');
    emulators[1]!.type('echo from-B\r');
    client.emit(data('t2', 'from-B', 's2'));
    expect(client.frames.filter((f) => f.op === 'write')).toMatchObject([
      { sessionId: 's1', terminalId: 't1', data: 'echo from-A\r' },
      { sessionId: 's2', terminalId: 't2', data: 'echo from-B\r' },
    ]);
    expect(emulators[0]!.text).not.toContain('from-B');
    expect(manager.getSession('s1').entries).toHaveLength(1);
  });

  it('marks an exited terminal with its code and stops forwarding input', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    client.emit(exit('t1', 3));
    expect(manager.getSession('s1').entries[0]).toMatchObject({ status: 'exited', exitCode: 3 });
    emulators[0]!.type('ls\r');
    expect(client.count('write')).toBe(0);
    await manager.restart('s1', 't1', null);
    expect(manager.getSession('s1').entries.map((e) => e.id)).toEqual(['t2']);
    expect(client.count('close')).toBe(0);
    expect(emulators[0]!.disposed).toBe(true);
  });

  it('closes terminals, moves the selection and shows the empty state after the last', async () => {
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    await manager.create('s1', 'C:\\w', null);
    await manager.close('s1', 't2');
    expect(client.frames.filter((f) => f.op === 'close')).toMatchObject([{ terminalId: 't2' }]);
    expect(manager.getSession('s1').activeId).toBe('t1');
    await manager.close('s1', 't1');
    expect(manager.getSession('s1')).toMatchObject({ entries: [], activeId: null });
    expect(client.count('create')).toBe(2);
  });

  it('sends a resize only when the fitted size changes', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    manager.fitAndSync('s1', 't1');
    expect(client.count('resize')).toBe(0);
    emulators[0]!.fitSize = { cols: 50, rows: 30 };
    manager.fitAndSync('s1', 't1');
    manager.fitAndSync('s1', 't1');
    expect(client.frames.filter((f) => f.op === 'resize')).toMatchObject([
      { terminalId: 't1', cols: 50, rows: 30 },
    ]);
  });

  it('re-attaches terminals the daemon already has, without creating one', async () => {
    const { client, manager, emulators } = setup();
    client.daemon.set('s1', [
      {
        id: 'old',
        pid: 4,
        cols: 90,
        rows: 20,
        state: { serialized: 'restart-marker', plainText: 'restart-marker', cols: 90, rows: 20 },
      },
    ]);
    await manager.attach('s1', 'C:\\w', null);
    expect(client.count('create')).toBe(0);
    expect(manager.getSession('s1').entries.map((e) => e.id)).toEqual(['old']);
    expect(emulators[0]).toMatchObject({ text: 'restart-marker', cols: 90, rows: 20 });
  });

  it('re-lists after a reconnect: restores content once, drops vanished shells, no create', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    await manager.create('s1', 'C:\\w', null);
    client.emit(data('t1', 'keep-me'));
    client.emit(data('t2', 'doomed'));
    client.setStatus('reconnecting');
    // While away: t2 is gone, t1 advanced.
    client.daemon.set('s1', [
      {
        id: 't1',
        pid: 1,
        cols: 100,
        rows: 30,
        state: { serialized: 'keep-me tick 1 tick 2', plainText: '', cols: 100, rows: 30 },
      },
    ]);
    client.setStatus('ready');
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getSession('s1').entries.map((e) => e.id)).toEqual(['t1']);
    expect(emulators[0]!.text).toBe('keep-me tick 1 tick 2');
    expect(emulators[1]!.disposed).toBe(true);
    expect(client.count('create')).toBe(2);
    client.emit(data('t1', ' tick 3'));
    expect(emulators[0]!.text).toBe('keep-me tick 1 tick 2 tick 3');
  });

  it('drops live frames that are already part of the snapshot being restored', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    let release!: () => void;
    client.listGate = new Promise((r) => (release = r));
    client.setStatus('reconnecting');
    client.setStatus('ready');
    client.emit(data('t1', 'in-snapshot'));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(emulators[0]!.text).toBe('');
  });

  it('shows an empty state with no ghost tabs after the daemon lost every shell', async () => {
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    client.daemon.set('s1', []);
    client.setStatus('reconnecting');
    client.setStatus('ready');
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getSession('s1').entries).toEqual([]);
    expect(client.count('create')).toBe(1);
  });

  it('reports a failed create and lets the user retry', async () => {
    const { client, manager } = setup();
    client.createError = 'boom';
    await manager.attach('s1', 'C:\\w', null);
    expect(manager.getSession('s1')).toMatchObject({ entries: [], error: 'boom' });
    client.createError = null;
    await manager.retry('s1', 'C:\\w', null);
    expect(manager.getSession('s1').entries).toHaveLength(1);
    expect(manager.getSession('s1').error).toBeNull();
  });

  it('dispose closes the sidecar and emulators but never closes shells', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    manager.dispose();
    expect(client.disposed).toBe(true);
    expect(emulators[0]!.disposed).toBe(true);
    expect(client.count('close')).toBe(0);
  });

  it('keeps the terminal and flags the failure while a close is rejected, then closes on retry', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    client.closeMode = 'reject';
    client.setStatus('reconnecting');
    await manager.close('s1', 't1');
    expect(manager.getSession('s1').entries.map((e) => e.id)).toEqual(['t1']);
    expect(manager.getSession('s1').closeFailed).toBe(true);
    expect(emulators[0]!.disposed).toBe(false);
    // The shell is still on the daemon, so it must still be listed after reconnect.
    client.closeMode = 'ok';
    client.setStatus('ready');
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getSession('s1').entries.map((e) => e.id)).toEqual(['t1']);
    expect(manager.getSession('s1').closeFailed).toBe(false);
    await manager.close('s1', 't1');
    expect(manager.getSession('s1').entries).toEqual([]);
    expect(client.daemon.get('s1')).toEqual([]);
  });

  it('keeps the terminal when the daemon answers a close with false', async () => {
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    client.closeMode = 'fail';
    await manager.close('s1', 't1');
    expect(manager.getSession('s1').entries.map((e) => e.id)).toEqual(['t1']);
    expect(manager.getSession('s1').closeFailed).toBe(true);
  });

  it('drops the tab when a failed close was only because the daemon no longer has the shell', async () => {
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    client.closeMode = 'fail';
    client.daemon.set('s1', []);
    await manager.close('s1', 't1');
    expect(manager.getSession('s1').entries).toEqual([]);
    expect(manager.getSession('s1').closeFailed).toBe(false);
  });

  it('ignores a second close while the first is in flight', async () => {
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    await Promise.all([manager.close('s1', 't1'), manager.close('s1', 't1')]);
    expect(client.count('close')).toBe(1);
  });
});

describe('TerminalManager reconcile after the sidecar becomes ready', () => {
  afterEach(() => vi.useRealTimers());

  const flush = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  it('marks entries stale and blocks input while the link is down, then restores them', async () => {
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    client.setStatus('reconnecting');
    expect(manager.getSession('s1').stale).toBe(true);
    emulators[0]!.type('x');
    expect(client.count('write')).toBe(0);
    client.setStatus('ready');
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getSession('s1').stale).toBe(false);
    expect(manager.getSession('s1').entries.map((e) => [e.id, e.status])).toEqual([
      ['t1', 'running'],
    ]);
    emulators[0]!.type('y');
    expect(client.count('write')).toBe(1);
  });

  it('retries the list with backoff until the daemon answers, then drops vanished terminals', async () => {
    vi.useFakeTimers();
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    await manager.create('s1', 'C:\\w', null);
    client.daemon.set('s1', []);
    client.setStatus('reconnecting');
    client.listFailures = 2;
    client.setStatus('ready');
    await flush();
    expect(client.count('list')).toBe(2);
    expect(manager.getSession('s1').entries).toHaveLength(2);
    expect(manager.getSession('s1').stale).toBe(true);
    await flush(500);
    expect(client.count('list')).toBe(3);
    await flush(1000);
    expect(client.count('list')).toBe(4);
    expect(manager.getSession('s1').entries).toEqual([]);
    expect(manager.getSession('s1').stale).toBe(false);
    expect(client.count('create')).toBe(2);
  });

  it('times out a hung list for one session without blocking the others', async () => {
    vi.useFakeTimers();
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    await manager.attach('s2', 'C:\\w', null);
    client.daemon.set('s1', []);
    client.daemon.set('s2', []);
    client.setStatus('reconnecting');
    client.listHangs = 1;
    client.setStatus('ready');
    await flush();
    expect(manager.getSession('s2').entries).toEqual([]);
    expect(manager.getSession('s1').entries).toHaveLength(1);
    await flush(5000 + 500);
    expect(manager.getSession('s1').entries).toEqual([]);
    expect(manager.getSession('s1').stale).toBe(false);
  });

  it('stops retrying when the link leaves ready or the manager is disposed', async () => {
    vi.useFakeTimers();
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    client.setStatus('reconnecting');
    client.listFailures = 99;
    client.setStatus('ready');
    await flush();
    expect(client.count('list')).toBe(2);
    client.setStatus('reconnecting');
    await flush(20_000);
    expect(client.count('list')).toBe(2);
    client.setStatus('ready');
    await flush();
    expect(client.count('list')).toBe(3);
    manager.dispose();
    await flush(20_000);
    expect(client.count('list')).toBe(3);
  });

  it('shows the shells as exited with input disabled once the retries are exhausted', async () => {
    vi.useFakeTimers();
    const { client, manager, emulators } = setup();
    await manager.attach('s1', 'C:\\w', null);
    client.setStatus('reconnecting');
    client.listFailures = 99;
    client.setStatus('ready');
    await flush(60_000);
    expect(client.count('list')).toBe(1 + 6);
    expect(manager.getSession('s1').entries.map((e) => e.status)).toEqual(['exited']);
    expect(manager.getSession('s1').stale).toBe(false);
    emulators[0]!.type('z');
    expect(client.count('write')).toBe(0);
  });

  it('never resurrects a terminal that was closed while a relist was in flight', async () => {
    const { client, manager } = setup();
    await manager.attach('s1', 'C:\\w', null);
    await manager.create('s1', 'C:\\w', null);
    client.setStatus('reconnecting');
    let release!: () => void;
    client.listGate = new Promise((r) => (release = r));
    client.setStatus('ready');
    await new Promise((r) => setTimeout(r, 0));
    await manager.close('s1', 't2');
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getSession('s1').entries.map((e) => e.id)).toEqual(['t1']);
  });
});
