import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { helperDir, manifestPath, runPs, scratchDir } from './ps-helpers';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

const url = 'wss://pc.tail1234.ts.net:8443';
const bridge = 'http://10.0.2.2:3102';
const bridgeSecret = 'bridge-secret-probe';
const fakeKey = 'fk-unit-test-key-0000000000000000';
const payloadNoKey = `droidmobile://pair?v=1&url=${url}&bridge=${bridge}&bridgeSecret=${bridgeSecret}`;
const pairArgs = `-Url '${url}' -BridgeUrl ${bridge} -BridgeSecret ${bridgeSecret}`;

interface Scratch {
  dir: string;
  localAppData: string;
  pairingDir: string;
  state: string;
  opens: string;
  copy: string;
}

function makeScratch(): Scratch {
  const s = scratchDir('pch-window-');
  cleanups.push(s.cleanup);
  const localAppData = join(s.dir, 'local');
  mkdirSync(localAppData);
  return {
    dir: s.dir,
    localAppData,
    pairingDir: join(localAppData, 'DroidMobile', 'pairing'),
    state: join(s.dir, 'state'),
    opens: join(s.dir, 'opens.log'),
    copy: join(s.dir, 'page-copy.html'),
  };
}

// Records every call and keeps a copy of the page plus the directory ACL while the page exists.
function openerStub(s: Scratch): string {
  const acl = join(s.dir, 'acl.json');
  return `{ param($p) Add-Content -LiteralPath '${s.opens}' -Value $p; Copy-Item -LiteralPath $p -Destination '${s.copy}'; $a = Get-Acl -LiteralPath (Split-Path $p); $o = [ordered]@{ protected = $a.AreAccessRulesProtected; users = @($a.Access | ForEach-Object { $_.IdentityReference.Value }); me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name }; $o | ConvertTo-Json -Compress | Set-Content -LiteralPath '${acl}' }`;
}

function pageRows(html: string): string[] {
  const svg = /<svg[^>]*viewBox="0 0 (\d+) \1"[^>]*>(.*?)<\/svg>/s.exec(html);
  if (!svg) throw new Error('no inline svg');
  const size = Number(svg[1]);
  const grid = Array.from({ length: size }, () => Array<string>(size).fill('0'));
  for (const m of svg[2].matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < w; i++) grid[y][x + i] = '1';
  }
  return grid.map((r) => r.join(''));
}

function qrRows(payload: string): string[] {
  const r = spawnSync(process.execPath, [join(helperDir, 'qr.mjs')], {
    input: payload,
    encoding: 'utf8',
  });
  return r.stdout.trim().split('\n');
}

function env(s: Scratch, extra: Record<string, string> = {}): Record<string, string> {
  return { LOCALAPPDATA: s.localAppData, DROIDMOBILE_PAIRING_FORCE_WINDOW: '1', ...extra };
}

function listing(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe('New-PairingCode QR page (VAL-PAIR-023..026)', () => {
  it('writes a self-contained page whose SVG is the QR of the printed payload, opens it once, deletes it after Enter and sweeps stale pages', () => {
    const s = makeScratch();
    mkdirSync(s.pairingDir, { recursive: true });
    const old = new Date(Date.now() - 86_400_000);
    for (const name of ['droidmobile-pairing-aaaa.html', 'droidmobile-pairing-bbbb.html']) {
      writeFileSync(join(s.pairingDir, name), 'stale');
      utimesSync(join(s.pairingDir, name), old, old);
    }
    writeFileSync(join(s.pairingDir, 'notes.txt'), 'keep me');

    const r = runPs(
      `New-PairingCode ${pairArgs} -StateDir '${s.state}' -Opener ${openerStub(s)}`,
      env(s, { FACTORY_API_KEY: fakeKey }),
      undefined,
      '\r\n',
    );

    expect(r.code).toBe(0);
    expect(r.out).toContain(payloadNoKey);
    expect(r.out).toContain('Press Enter once the phone is paired');
    const opens = readFileSync(s.opens, 'utf8').trim().split(/\r?\n/);
    expect(opens).toHaveLength(1);
    expect(opens[0].startsWith(s.pairingDir)).toBe(true);
    expect(opens[0]).toMatch(/droidmobile-pairing-[0-9a-f]{32}\.html$/);

    const html = readFileSync(s.copy, 'utf8');
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<script|<link|<img|src=|@import/i);
    expect(html).not.toMatch(/key=|fk-/);
    expect(html).not.toContain(fakeKey);
    expect(html).toContain('Scan QR code');
    expect(Number(/<svg[^>]*width="(\d+)"/.exec(html)?.[1])).toBeGreaterThanOrEqual(300);
    expect(pageRows(html)).toEqual(qrRows(payloadNoKey));

    expect(listing(s.pairingDir)).toEqual(['notes.txt']);
  });

  it('restricts the pairing directory to the current user and, with -IncludeApiKey, encodes the key only in the QR', () => {
    const s = makeScratch();
    const r = runPs(
      `New-PairingCode -Url '${url}' -IncludeApiKey -StateDir '${s.state}' -Opener ${openerStub(s)}`,
      env(s, { FACTORY_API_KEY: fakeKey }),
      undefined,
      '\r\n',
    );
    expect(r.code).toBe(0);
    const acl = JSON.parse(
      readFileSync(join(s.dir, 'acl.json'), 'utf8').replace(/^\uFEFF/, ''),
    ) as {
      protected: boolean;
      users: string[];
      me: string;
    };
    expect(acl.protected).toBe(true);
    expect(acl.users).toHaveLength(1);
    expect(acl.users[0].toLowerCase()).toBe(acl.me.toLowerCase());

    const html = readFileSync(s.copy, 'utf8');
    expect(html).not.toContain(fakeKey);
    expect(html).toContain('contains your Factory API key');
    const expected = `droidmobile://pair?v=1&url=${url}&key=${fakeKey}`;
    expect(pageRows(html)).toEqual(qrRows(expected));
    expect(listing(s.pairingDir)).toEqual([]);
    expect(listing(s.state)).toEqual([]);
  });

  it('-NoWindow, -PassThru, -NoQr and plain non-interactive runs create nothing and open nothing', () => {
    const s = makeScratch();
    const stub = openerStub(s);
    const cases = [
      [`New-PairingCode ${pairArgs} -StateDir '${s.state}' -NoWindow -Opener ${stub}`, env(s)],
      [
        `$null = New-PairingCode ${pairArgs} -StateDir '${s.state}' -PassThru -Opener ${stub}`,
        env(s),
      ],
      [`New-PairingCode ${pairArgs} -StateDir '${s.state}' -NoQr -Opener ${stub}`, env(s)],
      [
        `New-PairingCode ${pairArgs} -StateDir '${s.state}' -Opener ${stub}`,
        { LOCALAPPDATA: s.localAppData },
      ],
    ] as const;
    for (const [snippet, e] of cases) {
      const started = Date.now();
      const r = runPs(snippet, { ...e });
      expect(r.code).toBe(0);
      expect(r.out).toContain(payloadNoKey);
      expect(Date.now() - started).toBeLessThan(15_000);
    }
    expect(existsSync(s.pairingDir)).toBe(false);
    expect(existsSync(join(s.localAppData, 'DroidMobile'))).toBe(false);
    expect(existsSync(s.opens)).toBe(false);
  });

  it('deletes the page when the running command is stopped (Ctrl+C equivalent) and still opens it only once', async () => {
    const s = makeScratch();
    const inner = [
      `Import-Module '${manifestPath}' -Force`,
      `New-PairingCode ${pairArgs} -StateDir '${s.state}' -Opener ${openerStub(s)}`,
    ].join('; ');
    const script = [
      `$ps = [powershell]::Create()`,
      `[void]$ps.AddScript(@'\n${inner}\n'@)`,
      `$handle = $ps.BeginInvoke()`,
      `$deadline = (Get-Date).AddSeconds(40)`,
      `while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath '${s.opens}')) { Start-Sleep -Milliseconds 200 }`,
      `Start-Sleep -Milliseconds 800`,
      `$during = @(Get-ChildItem -LiteralPath '${s.pairingDir}' -Filter *.html).Count`,
      `$ps.Stop()`,
      `$after = @(Get-ChildItem -LiteralPath '${s.pairingDir}' -Filter *.html).Count`,
      `"during=$during after=$after"`,
    ].join('\n');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, ...env(s) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    cleanups.push(() => void child.kill());
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code).toBe(0);
    expect(out).toContain('during=1 after=0');
    expect(readFileSync(s.opens, 'utf8').trim().split(/\r?\n/)).toHaveLength(1);
  }, 90_000);

  it('keeps the page until Enter arrives on stdin', async () => {
    const s = makeScratch();
    const command = `Import-Module '${manifestPath}' -Force; New-PairingCode ${pairArgs} -StateDir '${s.state}' -Opener ${openerStub(s)}`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      env: { ...process.env, ...env(s) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    cleanups.push(() => void child.kill());
    const closed = new Promise<number | null>((resolve) => child.on('close', resolve));
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline && !existsSync(s.opens)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 1_000));
    expect(listing(s.pairingDir)).toHaveLength(1);
    child.stdin.write('\r\n');
    expect(await closed).toBe(0);
    expect(listing(s.pairingDir)).toEqual([]);
  }, 90_000);
});
