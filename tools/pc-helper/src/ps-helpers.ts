import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Walk up from cwd instead of using import.meta.url, which is not a file: URL under jsdom.
function findHelperDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    for (const candidate of [dir, resolve(dir, 'tools', 'pc-helper')]) {
      if (existsSync(join(candidate, 'DroidMobileHelper.psd1'))) return candidate;
    }
    dir = resolve(dir, '..');
  }
  throw new Error('tools/pc-helper not found');
}

export const helperDir = findHelperDir();
export const manifestPath = join(helperDir, 'DroidMobileHelper.psd1');

export interface PsResult {
  code: number | null;
  out: string;
}

/** Runs a snippet in Windows PowerShell 5.1 with the helper module imported. */
export function runPs(snippet: string, env: Record<string, string> = {}, cwd?: string): PsResult {
  const command = `Import-Module '${manifestPath}' -Force; ${snippet}`;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000, cwd },
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

export function scratchDir(prefix: string): { dir: string; cleanup: () => void } {
  // The hosted runner's os.tmpdir() is an 8.3 short path (RUNNER~1); PowerShell reports the long form.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Writes a stub droid.cmd that prints a version, so tests never depend on an installed Droid CLI. */
export function fakeDroid(dir: string): string {
  const exe = join(dir, 'droid.cmd');
  writeFileSync(exe, '@echo off\r\necho 9.9.9\r\n');
  return exe;
}
