import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runPs, scratchDir } from './ps-helpers';

// Real droid daemon on the spare throwaway port (AGENTS.md: 3109). Skipped when it is busy.
const PORT = 3109;
const scratch = scratchDir('pch-daemon-');

function listeners(port: number): number[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalAddress + '/' + $_.OwningProcess }) -join ','`,
    ],
    { encoding: 'utf8' },
  ).trim();
  return out === '' ? [] : out.split(',').map((entry) => Number(entry.split('/')[1]));
}

function processCount(pattern: string): number {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'powershell.exe','droid.exe' -and $_.CommandLine -like '${pattern}' -and $_.ProcessId -ne $PID }).Count`,
    ],
    { encoding: 'utf8' },
  ).trim();
  return Number(out);
}

async function health(): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

const busy = listeners(PORT).length > 0;

afterAll(() => {
  if (!busy) runPs(`Stop-DroidDaemon -Port ${PORT} -StateDir '${scratch.dir}'`);
  scratch.cleanup();
});

describe.skipIf(busy)('supervised daemon lifecycle (VAL-PCH-002/004/005/007)', () => {
  const pidFile = join(scratch.dir, `daemon-${PORT}.pid`);

  it('starts detached, answers /health on loopback only, and records the PID', async () => {
    const r = runPs(`Start-DroidDaemon -Port ${PORT} -StateDir '${scratch.dir}'`);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`127.0.0.1:${PORT}`);
    expect(await health()).toBe('factory-daemon ok');
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(listeners(PORT)).toEqual([pid]);
    const addr = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen).LocalAddress`,
      ],
      { encoding: 'utf8' },
    ).trim();
    expect(addr).toBe('127.0.0.1');
  }, 60_000);

  it('is idempotent: a second start reports already running with the same PID', () => {
    const before = readFileSync(pidFile, 'utf8').trim();
    const r = runPs(`Start-DroidDaemon -Port ${PORT} -StateDir '${scratch.dir}'`);
    expect(r.code).toBe(0);
    expect(r.out).toContain('already running');
    expect(r.out).toContain(`daemon PID ${before}`);
    expect(readFileSync(pidFile, 'utf8').trim()).toBe(before);
    expect(processCount(`*supervisor.ps1*-Port ${PORT} *`)).toBe(1);
    expect(processCount(`*daemon --host 127.0.0.1 --port ${PORT}*`)).toBe(1);
  }, 60_000);

  it('restarts the daemon within 30 s after a crash and logs it', async () => {
    const before = Number(readFileSync(pidFile, 'utf8').trim());
    process.kill(before);
    const deadline = Date.now() + 30_000;
    let after = before;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (existsSync(pidFile)) after = Number(readFileSync(pidFile, 'utf8').trim());
      if (after !== before && (await health()) === 'factory-daemon ok') break;
    }
    expect(after).not.toBe(before);
    expect(await health()).toBe('factory-daemon ok');
    const log = readFileSync(join(scratch.dir, 'logs', `supervisor-${PORT}.log`), 'utf8');
    expect(log).toContain(`daemon pid=${before}`);
    expect(log).toMatch(/restarting daemon/);
  }, 60_000);

  it('stop ends supervisor and daemon, removes the PID file and frees the port', () => {
    const r = runPs(`Stop-DroidDaemon -Port ${PORT} -StateDir '${scratch.dir}'`);
    expect(r.code).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
    expect(listeners(PORT)).toEqual([]);
    expect(processCount(`*supervisor.ps1*-Port ${PORT} *`)).toBe(0);
    expect(processCount(`*daemon --host 127.0.0.1 --port ${PORT}*`)).toBe(0);
  }, 60_000);
});

describe.skipIf(busy)('relative caller paths', () => {
  it('starts detached with a relative -StateDir and -DroidExe, then stops from another cwd', async () => {
    const exe = runPs(`& (Get-Module DroidMobileHelper) { Resolve-DhDroidExe $null }`).out.trim();
    const relativeExe = relative(scratch.dir, exe);
    expect(isAbsolute(relativeExe)).toBe(false);
    const state = join(scratch.dir, 'rel');
    const elsewhere = scratchDir('pch-daemon-cwd-');
    try {
      const start = runPs(
        `Start-DroidDaemon -Port ${PORT} -StateDir .\\rel -DroidExe '${relativeExe}'`,
        {},
        scratch.dir,
      );
      expect(start.code).toBe(0);
      // A pooled keep-alive socket to the previous daemon on this port fails once, so retry.
      let answer = await health();
      for (let attempt = 0; answer === null && attempt < 3; attempt++) answer = await health();
      expect(answer).toBe('factory-daemon ok');
      expect(existsSync(join(state, `daemon-${PORT}.pid`))).toBe(true);
    } finally {
      const stop = runPs(`Stop-DroidDaemon -Port ${PORT} -StateDir '${state}'`, {}, elsewhere.dir);
      elsewhere.cleanup();
      expect(stop.code).toBe(0);
    }
    expect(listeners(PORT)).toEqual([]);
  }, 90_000);
});
