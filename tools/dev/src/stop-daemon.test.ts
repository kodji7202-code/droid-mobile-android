import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(__dirname, '..', 'stop-daemon.ps1');
const PORT = 3107;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnTracked(args: string[]): ChildProcess {
  const child = spawn(process.execPath, args, { stdio: 'ignore' });
  cleanups.push(() => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  });
  return child;
}

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stopd-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runStop(dir: string) {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Port',
      String(PORT),
      '-StateDir',
      dir,
    ],
    { encoding: 'utf8' },
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function startTimeOf(pid: number): string {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CreationDate.ToUniversalTime().ToString('o')`,
    ],
    { encoding: 'utf8' },
  );
  return r.stdout.trim();
}

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

const listenerCode = `require('net').createServer().listen(${PORT},'127.0.0.1');setInterval(()=>{},1000)`;
const idleCode = 'setInterval(()=>{},1000)';

describe.skipIf(process.platform !== 'win32')('stop-daemon.ps1', () => {
  it('never kills a foreign listener on the port when no record exists', async () => {
    const foreign = spawnTracked(['-e', listenerCode]);
    await waitFor(() => {
      const r = spawnSync('powershell', [
        '-NoProfile',
        '-Command',
        `if (Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`,
      ]);
      return r.status === 0;
    });
    const { code, out } = runStop(stateDir());
    expect(code).toBe(1);
    expect(out).toContain('REFUSED');
    expect(alive(foreign.pid as number)).toBe(true);
  }, 30000);

  it('stops a recorded daemon whose identity matches and clears the record', async () => {
    const owned = spawnTracked([
      '-e',
      idleCode,
      'daemon',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
    ]);
    const pid = owned.pid as number;
    await waitFor(() => startTimeOf(pid) !== '');
    const dir = stateDir();
    const file = join(dir, `daemon-${PORT}.pid`);
    writeFileSync(file, JSON.stringify({ pid, startTime: startTimeOf(pid) }));
    const { code, out } = runStop(dir);
    expect(out).toContain('stopped daemon');
    expect(code).toBe(0);
    await waitFor(() => !alive(pid));
    expect(existsSync(file)).toBe(false);
  }, 30000);

  it('does not kill a live process when the record is stale (start time mismatch)', async () => {
    const other = spawnTracked([
      '-e',
      idleCode,
      'daemon',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
    ]);
    const pid = other.pid as number;
    await waitFor(() => startTimeOf(pid) !== '');
    const dir = stateDir();
    const file = join(dir, `daemon-${PORT}.pid`);
    writeFileSync(file, JSON.stringify({ pid, startTime: '2001-01-01T00:00:00.0000000Z' }));
    const { code, out } = runStop(dir);
    expect(code).toBe(1);
    expect(out).toContain('REFUSED');
    expect(alive(pid)).toBe(true);
    expect(existsSync(file)).toBe(false);
  }, 30000);

  it('does not kill a live process whose command line is not the daemon', async () => {
    const other = spawnTracked(['-e', idleCode]);
    const pid = other.pid as number;
    await waitFor(() => startTimeOf(pid) !== '');
    const dir = stateDir();
    writeFileSync(
      join(dir, `daemon-${PORT}.pid`),
      JSON.stringify({ pid, startTime: startTimeOf(pid) }),
    );
    const { code, out } = runStop(dir);
    expect(code).toBe(1);
    expect(out).toContain('REFUSED');
    expect(alive(pid)).toBe(true);
  }, 30000);

  it('refuses a legacy bare-pid record without killing', async () => {
    const other = spawnTracked([
      '-e',
      idleCode,
      'daemon',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
    ]);
    const pid = other.pid as number;
    const dir = stateDir();
    writeFileSync(join(dir, `daemon-${PORT}.pid`), String(pid));
    const { code } = runStop(dir);
    expect(code).toBe(1);
    expect(alive(pid)).toBe(true);
  }, 30000);
});
