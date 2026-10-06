import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, connect, type Server } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { helperDir, runPs, scratchDir } from './ps-helpers';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function psFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'src') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...psFiles(full));
    else if (/\.(ps1|psm1|psd1)$/i.test(name)) found.push(full);
  }
  return found;
}

function payloadLine(out: string): string {
  const line = out.split(/\r?\n/).find((l) => l.startsWith('droidmobile://pair?'));
  if (!line) throw new Error(`no payload in output: ${out}`);
  return line;
}

describe('module surface (VAL-PCH-001)', () => {
  it('every .ps1/.psm1/.psd1 parses on Windows PowerShell 5.1 with zero errors', () => {
    const files = psFiles(helperDir);
    expect(files.length).toBeGreaterThanOrEqual(6);
    const list = files.map((f) => `'${f}'`).join(',');
    const r = runPs(
      `foreach ($f in @(${list})) { $e=$null;$t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$t,[ref]$e); "$f errors=$($e.Count)" }`,
    );
    expect(r.out).not.toMatch(/errors=[1-9]/);
    expect(r.out.match(/errors=0/g)?.length).toBe(files.length);
  });

  it('import prints nothing and exposes the daemon, serve and pairing commands', () => {
    const r = runPs(
      "'IMPORTED'; (Get-Command -Module DroidMobileHelper | Sort-Object Name | ForEach-Object Name) -join ','",
    );
    expect(r.code).toBe(0);
    expect(r.out.trim().split(/\r?\n/)[0]).toBe('IMPORTED');
    for (const name of [
      'Start-DroidDaemon',
      'Stop-DroidDaemon',
      'Enable-TailscaleServe',
      'Disable-TailscaleServe',
      'New-PairingCode',
    ]) {
      expect(r.out).toContain(name);
    }
  });
});

describe('New-PairingCode (VAL-PCH-013, VAL-PCH-023)', () => {
  const url = 'wss://pc.tail1234.ts.net:8443';
  const fakeKey = 'fk-unit-test-key-0000000000000000';

  it('prints url only, no key even when FACTORY_API_KEY is set, plus a QR block', () => {
    const scratch = scratchDir('pch-pair-');
    cleanups.push(scratch.cleanup);
    const r = runPs(`New-PairingCode -Url '${url}' -StateDir '${scratch.dir}'`, {
      FACTORY_API_KEY: fakeKey,
    });
    expect(r.code).toBe(0);
    expect(payloadLine(r.out)).toBe(`droidmobile://pair?v=1&url=${url}`);
    expect(r.out).not.toContain('key=');
    expect(r.out).not.toContain(fakeKey);
    expect(r.out).toMatch(/^ {8}(##| {2})+$/m);
    expect(readdirSync(scratch.dir)).toEqual([]);
  });

  it('adds bridge and bridgeSecret together, reading the secret from the environment', () => {
    const r = runPs(`New-PairingCode -Url '${url}' -BridgeUrl http://10.0.2.2:3102 -NoQr`, {
      DROIDMOBILE_BRIDGE_SECRET: 'bridge-secret-value',
    });
    expect(r.code).toBe(0);
    expect(payloadLine(r.out)).toBe(
      `droidmobile://pair?v=1&url=${url}&bridge=http://10.0.2.2:3102&bridgeSecret=bridge-secret-value`,
    );
  });

  it('refuses a bridge URL without a secret and a secret without a bridge URL', () => {
    const noSecret = runPs(`New-PairingCode -Url '${url}' -BridgeUrl http://10.0.2.2:3102 -NoQr`, {
      DROIDMOBILE_BRIDGE_SECRET: '',
    });
    expect(noSecret.code).not.toBe(0);
    expect(noSecret.out).toContain('pairing secret');
    const orphan = runPs(`New-PairingCode -Url '${url}' -BridgeSecret abc -NoQr`);
    expect(orphan.code).not.toBe(0);
  });

  it('rejects a URL that is not ws:// or wss://', () => {
    const r = runPs("New-PairingCode -Url 'https://example.com' -NoQr");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('-Url must look like');
  });

  it('-IncludeApiKey shows the key and a warning on screen and writes nothing to disk', () => {
    const scratch = scratchDir('pch-key-');
    cleanups.push(scratch.cleanup);
    const r = runPs(
      `New-PairingCode -Url '${url}' -IncludeApiKey -NoQr -StateDir '${scratch.dir}'`,
      { FACTORY_API_KEY: fakeKey },
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('WARNING');
    const params = new URL(payloadLine(r.out).replace('droidmobile://', 'https://')).searchParams;
    expect(params.get('key')).toBe(fakeKey);
    expect(params.get('url')).toBe(url);
    expect(readdirSync(scratch.dir)).toEqual([]);
  });
});

describe('qr.mjs', () => {
  it('emits a square 0/1 matrix with a quiet zone, reading stdin only', () => {
    const r = spawnSync(process.execPath, [join(helperDir, 'qr.mjs')], {
      input: 'droidmobile://pair?v=1&url=wss://pc.ts.net:8443',
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const rows = r.stdout.trim().split('\n');
    expect(rows.length).toBe(rows[0].length);
    expect(rows.every((row) => /^[01]+$/.test(row))).toBe(true);
    expect(rows[0]).toMatch(/^0+$/);
  });

  it('fails on an empty payload', () => {
    const r = spawnSync(process.execPath, [join(helperDir, 'qr.mjs')], {
      input: '',
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
  });
});

describe('daemon commands without starting a daemon', () => {
  const port = 3192;

  function listen(): Promise<Server> {
    return new Promise((resolveListen, reject) => {
      const server = createServer((socket) => socket.end());
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolveListen(server));
      cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
    });
  }

  function canConnect(): Promise<boolean> {
    return new Promise((resolveConnect) => {
      const socket = connect({ port, host: '127.0.0.1' }, () => {
        socket.destroy();
        resolveConnect(true);
      });
      socket.once('error', () => resolveConnect(false));
    });
  }

  it('-WhatIf changes nothing (VAL-PCH-008)', () => {
    const scratch = scratchDir('pch-whatif-');
    cleanups.push(scratch.cleanup);
    const state = join(scratch.dir, 'state');
    const r = runPs(
      `Start-DroidDaemon -Port ${port} -StateDir '${state}' -WhatIf; Stop-DroidDaemon -Port ${port} -StateDir '${state}' -WhatIf`,
    );
    expect(r.out).toContain('What if');
    expect(existsSync(state)).toBe(false);
  });

  it('Stop with no record and a free port is a no-op that exits 0', () => {
    const scratch = scratchDir('pch-stop-');
    cleanups.push(scratch.cleanup);
    const r = runPs(`Stop-DroidDaemon -Port ${port} -StateDir '${scratch.dir}'`);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Nothing to stop');
  });

  it('Start and Stop refuse a listener the helper did not start and leave it alone (VAL-PCH-006)', async () => {
    const scratch = scratchDir('pch-foreign-');
    cleanups.push(scratch.cleanup);
    await listen();
    const start = runPs(`Start-DroidDaemon -Port ${port} -StateDir '${scratch.dir}'`);
    expect(start.code).not.toBe(0);
    expect(start.out).toContain('did not start');
    const stop = runPs(`Stop-DroidDaemon -Port ${port} -StateDir '${scratch.dir}'`);
    expect(stop.code).not.toBe(0);
    expect(stop.out).toContain('did not start');
    expect(await canConnect()).toBe(true);
    expect(readdirSync(scratch.dir)).toEqual([]);
  });

  it('Stop refuses a corrupt record without killing anything', () => {
    const scratch = scratchDir('pch-corrupt-');
    cleanups.push(scratch.cleanup);
    const record = join(scratch.dir, `daemon-${port}.json`);
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Set-Content -LiteralPath '${record}' -Value 'not json'`,
    ]);
    const r = runPs(`Stop-DroidDaemon -Port ${port} -StateDir '${scratch.dir}'`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('not a valid record');
    expect(readFileSync(record, 'utf8')).toContain('not json');
  });
});
