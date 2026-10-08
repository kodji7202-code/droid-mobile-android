import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeDroid, helperDir, runPs, scratchDir } from './ps-helpers';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

const SECRET = 'S3cretSecretValue0123456789abcdefghijkl';
const OWNER_MARKER = '--droidmobile-hook';

function scratch(prefix: string): string {
  const s = scratchDir(prefix);
  cleanups.push(s.cleanup);
  return s.dir;
}

function sha(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function backups(dir: string, name: string): string[] {
  return readdirSync(dir).filter((f) => f.startsWith(`${name}.droidmobile-backup-`));
}

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string; timeout?: number }>;
}

function owned(map: Record<string, unknown>, event: string): HookEntry[] {
  const groups = (map[event] ?? []) as HookEntry[];
  return groups.filter((g) => g.hooks.some((h) => h.command.includes(OWNER_MARKER)));
}

const userHook = { type: 'command', command: 'echo user-stop' };
const original = {
  logoAnimation: false,
  nested: { list: [1, 2, { three: 3 }], empty: {}, none: null },
  hooks: {
    Stop: [{ hooks: [userHook] }],
    PreToolUse: [{ matcher: 'Execute', hooks: [{ type: 'command', command: 'echo pre' }] }],
  },
};

function writeOriginal(dir: string, doc: unknown = original): string {
  const file = join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return file;
}

describe('Install-DroidHooks and Uninstall-DroidHooks (VAL-PCH-014..017)', () => {
  it('backs up first, adds Notification and Stop entries, keeps the secret out of the file (014)', () => {
    const dir = scratch('pch-hooks-');
    const file = writeOriginal(dir);
    const before = sha(file);
    const secretFile = join(dir, 'pair-secret.txt');
    writeFileSync(secretFile, `${SECRET}\n`);
    const state = join(dir, 'state');

    const r = runPs(
      `Install-DroidHooks -SettingsPath '${file}' -StateDir '${state}' -BridgeUrl http://127.0.0.1:3102 -BridgeSecretFile '${secretFile}'`,
    );
    expect(r.code).toBe(0);

    const [backup] = backups(dir, 'settings.json');
    expect(backups(dir, 'settings.json')).toHaveLength(1);
    expect(sha(join(dir, backup))).toBe(before);

    const text = readFileSync(file, 'utf8');
    const doc = readJson(file);
    const hooks = doc.hooks as Record<string, unknown>;
    for (const event of ['Notification', 'Stop']) {
      const entries = owned(hooks, event);
      expect(entries).toHaveLength(1);
      expect(entries[0].hooks[0].type).toBe('command');
    }
    expect(text).not.toContain(SECRET);
    expect(r.out).not.toContain(SECRET);

    const config = readJson(join(state, 'bridge.json'));
    expect(config).toEqual({ url: 'http://127.0.0.1:3102', secret: SECRET });
  });

  it('is idempotent and leaves unrelated keys and the user Stop hook deep-equal (015)', () => {
    const dir = scratch('pch-hooks-');
    const file = writeOriginal(dir);
    const state = join(dir, 'state');
    for (let i = 0; i < 2; i++) {
      expect(runPs(`Install-DroidHooks -SettingsPath '${file}' -StateDir '${state}'`).code).toBe(0);
    }
    const doc = readJson(file) as typeof original & { hooks: Record<string, unknown> };
    expect(owned(doc.hooks, 'Notification')).toHaveLength(1);
    expect(owned(doc.hooks, 'Stop')).toHaveLength(1);
    expect(backups(dir, 'settings.json')).toHaveLength(1);

    const { Notification: _n, ...restHooks } = doc.hooks;
    const stop = (restHooks.Stop as HookEntry[]).filter(
      (g) => !g.hooks[0].command.includes(OWNER_MARKER),
    );
    expect({ ...doc, hooks: { ...restHooks, Stop: stop } }).toEqual(original);
  });

  it('refuses an unparseable file, names it, and changes nothing (016)', () => {
    const dir = scratch('pch-hooks-');
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{ "hooks": { oops');
    const before = sha(file);
    const r = runPs(`Install-DroidHooks -SettingsPath '${file}' -StateDir '${join(dir, 'state')}'`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(file);
    expect(sha(file)).toBe(before);
    expect(backups(dir, 'settings.json')).toHaveLength(0);
    expect(r.out).toMatch(/not valid JSON/);
  });

  it('uninstall restores the original, keeps a hook added later, and a second run says nothing to remove (017)', () => {
    const dir = scratch('pch-hooks-');
    const file = writeOriginal(dir);
    const state = join(dir, 'state');
    runPs(`Install-DroidHooks -SettingsPath '${file}' -StateDir '${state}'`);

    const added = readJson(file) as { hooks: { Stop: HookEntry[] } };
    added.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo added-later' }] });
    writeFileSync(file, JSON.stringify(added, null, 2));

    const r = runPs(`Uninstall-DroidHooks -SettingsPath '${file}'`);
    expect(r.code).toBe(0);
    const afterDoc = readJson(file) as { hooks: { Stop: HookEntry[] } };
    expect(afterDoc.hooks.Stop).toEqual([
      { hooks: [userHook] },
      { hooks: [{ type: 'command', command: 'echo added-later' }] },
    ]);
    afterDoc.hooks.Stop = [{ hooks: [userHook] }];
    expect(afterDoc).toEqual(original);

    const again = runPs(`Uninstall-DroidHooks -SettingsPath '${file}'`);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/Nothing to remove/);
  });

  it('removes a hooks key it created itself so the file equals the original', () => {
    const dir = scratch('pch-hooks-');
    const plain = { theme: 'dark', list: [] as number[] };
    const file = writeOriginal(dir, plain);
    runPs(`Install-DroidHooks -SettingsPath '${file}' -StateDir '${join(dir, 'state')}'`);
    expect(readJson(file).hooks).toBeDefined();
    runPs(`Uninstall-DroidHooks -SettingsPath '${file}'`);
    expect(readJson(file)).toEqual(plain);
  });

  it.each([
    ['an empty hooks object', { theme: 'dark', hooks: {} }],
    ['empty Stop and Notification arrays', { hooks: { Stop: [], Notification: [] } }],
    ['an empty Stop array beside other events', { hooks: { Stop: [], PreToolUse: [] } }],
    [
      'an empty Notification array only',
      { hooks: { Notification: [], Stop: [{ hooks: [userHook] }] } },
    ],
  ])('restores %s deep-equal after install and uninstall', (_name, doc) => {
    const dir = scratch('pch-hooks-');
    const file = writeOriginal(dir, doc);
    const state = join(dir, 'state');
    for (let i = 0; i < 2; i++) {
      expect(runPs(`Install-DroidHooks -SettingsPath '${file}' -StateDir '${state}'`).code).toBe(0);
    }
    const installed = readJson(file).hooks as Record<string, unknown>;
    expect(owned(installed, 'Stop')).toHaveLength(1);
    expect(owned(installed, 'Notification')).toHaveLength(1);
    expect(runPs(`Uninstall-DroidHooks -SettingsPath '${file}'`).code).toBe(0);
    expect(readJson(file)).toEqual(doc);
  });

  it('removes the arrays it created beside a pre-existing empty one', () => {
    const dir = scratch('pch-hooks-');
    const doc = { hooks: { Stop: [] } };
    const file = writeOriginal(dir, doc);
    runPs(`Install-DroidHooks -SettingsPath '${file}' -StateDir '${join(dir, 'state')}'`);
    runPs(`Uninstall-DroidHooks -SettingsPath '${file}'`);
    const after = readJson(file) as { hooks: Record<string, unknown> };
    expect(after.hooks).toEqual({ Stop: [] });
    expect('Notification' in after.hooks).toBe(false);
  });
  it('-RemoveBridgeConfig deletes the stored bridge.json even though its access is restricted', () => {
    const dir = scratch('pch-hooks-');
    const file = writeOriginal(dir);
    const state = join(dir, 'state');
    const install = runPs(
      `Install-DroidHooks -SettingsPath '${file}' -StateDir '${state}' -BridgeUrl http://127.0.0.1:3102 -BridgeSecret ${SECRET}`,
    );
    expect(install.code).toBe(0);
    expect(existsSync(join(state, 'bridge.json'))).toBe(true);

    const r = runPs(
      `Uninstall-DroidHooks -SettingsPath '${file}' -StateDir '${state}' -RemoveBridgeConfig`,
    );
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/denied/i);
    expect(existsSync(join(state, 'bridge.json'))).toBe(false);
  });

  it('-WhatIf changes nothing and creates no backup or config', () => {
    const dir = scratch('pch-hooks-');
    const file = writeOriginal(dir);
    const before = sha(file);
    const state = join(dir, 'state');
    const r = runPs(
      `Install-DroidHooks -SettingsPath '${file}' -StateDir '${state}' -BridgeUrl http://127.0.0.1:3102 -BridgeSecret ${SECRET} -WhatIf`,
    );
    expect(r.code).toBe(0);
    expect(sha(file)).toBe(before);
    expect(backups(dir, 'settings.json')).toHaveLength(0);
    expect(existsSync(state)).toBe(false);
    expect(r.out).not.toContain(SECRET);
  });

  it('prefers hooks.json next to the settings file and leaves the settings file byte-identical (024)', () => {
    const dirA = scratch('pch-hooks-a-');
    const fileA = writeOriginal(dirA);
    const dirB = scratch('pch-hooks-b-');
    const fileB = writeOriginal(dirB);
    const hooksB = join(dirB, 'hooks.json');
    const hooksOriginal = { Stop: [{ hooks: [userHook] }] };
    writeFileSync(hooksB, JSON.stringify(hooksOriginal, null, 2));
    const settingsHash = sha(fileB);
    const hooksHash = sha(hooksB);

    expect(
      runPs(`Install-DroidHooks -SettingsPath '${fileA}' -StateDir '${join(dirA, 's')}'`).code,
    ).toBe(0);
    expect(existsSync(join(dirA, 'hooks.json'))).toBe(false);
    expect(owned(readJson(fileA).hooks as Record<string, unknown>, 'Stop')).toHaveLength(1);

    expect(
      runPs(`Install-DroidHooks -SettingsPath '${fileB}' -StateDir '${join(dirB, 's')}'`).code,
    ).toBe(0);
    expect(sha(fileB)).toBe(settingsHash);
    const hooksDoc = readJson(hooksB);
    expect(owned(hooksDoc, 'Notification')).toHaveLength(1);
    expect(owned(hooksDoc, 'Stop')).toHaveLength(1);
    const [backup] = backups(dirB, 'hooks.json');
    expect(backups(dirB, 'hooks.json')).toHaveLength(1);
    expect(sha(join(dirB, backup))).toBe(hooksHash);
    expect(backups(dirB, 'settings.json')).toHaveLength(0);

    expect(runPs(`Uninstall-DroidHooks -SettingsPath '${fileA}'`).code).toBe(0);
    expect(runPs(`Uninstall-DroidHooks -SettingsPath '${fileB}'`).code).toBe(0);
    expect(readJson(fileA)).toEqual(original);
    expect(readJson(hooksB)).toEqual(hooksOriginal);
    expect(sha(fileB)).toBe(settingsHash);
  });

  it('writes into a wrapped hooks.json when that is the shape in use', () => {
    const dir = scratch('pch-hooks-');
    const file = writeOriginal(dir);
    const hooksFile = join(dir, 'hooks.json');
    const wrapped = { hooks: { Stop: [{ hooks: [userHook] }] } };
    writeFileSync(hooksFile, JSON.stringify(wrapped));
    runPs(`Install-DroidHooks -SettingsPath '${file}' -StateDir '${join(dir, 's')}'`);
    const doc = readJson(hooksFile) as { hooks: Record<string, unknown>; Notification?: unknown };
    expect(doc.Notification).toBeUndefined();
    expect(owned(doc.hooks, 'Notification')).toHaveLength(1);
    runPs(`Uninstall-DroidHooks -SettingsPath '${file}'`);
    expect(readJson(hooksFile)).toEqual(wrapped);
  });
});

describe('hook.mjs (VAL-PCH-018)', () => {
  const hookScript = join(helperDir, 'hook.mjs');
  const PORT = 3197;

  async function listen(
    received: Array<{ headers: IncomingMessage['headers']; body: string }>,
  ): Promise<Server> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"sent":0,"dryRun":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return server;
  }

  interface RunResult {
    code: number | null;
    stdout: string;
    elapsed: number;
  }

  // The listener lives in this process, so the child must be asynchronous.
  function runCommand(
    file: string,
    args: string[],
    stdin: string,
    env: Record<string, string>,
    verbatim = false,
    cwd?: string,
  ): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn(file, args, {
        env: { ...process.env, ...env },
        windowsVerbatimArguments: verbatim,
        cwd,
      });
      let stdout = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, elapsed: Date.now() - started }));
      child.stdin.end(stdin);
    });
  }

  function runHook(stdin: string, env: Record<string, string>, home: string): Promise<RunResult> {
    return runCommand('node', [hookScript, OWNER_MARKER], stdin, {
      ...env,
      DROIDMOBILE_HELPER_HOME: home,
    });
  }

  const sample = {
    session_id: 'sess-123',
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: 'SENTINEL-MESSAGE',
    cwd: 'C:/SENTINEL-CWD',
    transcript_path: 'C:/SENTINEL-TRANSCRIPT',
    tool_input: { command: 'SENTINEL-TOOL' },
  };

  it('sends only the three documented fields with the bearer credential', async () => {
    const dir = scratch('pch-hook-');
    const received: Array<{ headers: IncomingMessage['headers']; body: string }> = [];
    await listen(received);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'bridge.json'),
      JSON.stringify({ url: `http://127.0.0.1:${PORT}`, secret: SECRET }),
    );
    const r = await runHook(JSON.stringify(sample), {}, dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(received).toHaveLength(1);
    expect(received[0].headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(received[0].body)).toEqual({
      session_id: 'sess-123',
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
    });
    expect(received[0].body).not.toMatch(/SENTINEL/);
  });

  it('sends a Stop event without notification_type, using environment configuration', async () => {
    const dir = scratch('pch-hook-');
    const received: Array<{ headers: IncomingMessage['headers']; body: string }> = [];
    await listen(received);
    const r = await runHook(
      JSON.stringify({ ...sample, hook_event_name: 'Stop' }),
      { DROIDMOBILE_BRIDGE_URL: `http://127.0.0.1:${PORT}`, DROIDMOBILE_BRIDGE_SECRET: SECRET },
      dir,
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(received[0].body)).toEqual({
      session_id: 'sess-123',
      hook_event_name: 'Stop',
    });
  });

  it('exits 0 quickly with empty stdout when the bridge is unreachable', async () => {
    const dir = scratch('pch-hook-');
    const r = await runHook(
      JSON.stringify(sample),
      { DROIDMOBILE_BRIDGE_URL: 'http://127.0.0.1:3198', DROIDMOBILE_BRIDGE_SECRET: SECRET },
      dir,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.elapsed).toBeLessThan(5000);
    expect(readFileSync(join(dir, 'logs', 'hook.log'), 'utf8')).not.toContain(SECRET);
  });

  it('exits 0 silently for garbage input and when no bridge is configured', async () => {
    const dir = scratch('pch-hook-');
    expect(await runHook('not json', {}, dir)).toMatchObject({ code: 0, stdout: '' });
    expect(await runHook(JSON.stringify(sample), {}, dir)).toMatchObject({ code: 0, stdout: '' });
  });

  it('runs from the command Install-DroidHooks writes, through cmd /c', async () => {
    const dir = scratch('pch-hook-');
    const file = writeOriginal(dir);
    const state = join(dir, 'state');
    runPs(
      `Install-DroidHooks -SettingsPath '${file}' -StateDir '${state}' -BridgeUrl http://127.0.0.1:${PORT} -BridgeSecret ${SECRET}`,
    );
    const hooks = readJson(file).hooks as Record<string, unknown>;
    const command = owned(hooks, 'Notification')[0].hooks[0].command;
    expect(command).not.toContain(SECRET);

    const received: Array<{ headers: IncomingMessage['headers']; body: string }> = [];
    await listen(received);
    const result = await runCommand(
      'cmd.exe',
      ['/d', '/s', '/c', command],
      JSON.stringify(sample),
      {},
      true,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].body).session_id).toBe('sess-123');
  });

  it('keeps a relative -StateDir working when the hook later runs from another directory', async () => {
    const dir = scratch('pch-hook-');
    const elsewhere = scratch('pch-hook-cwd-');
    writeOriginal(dir);
    const install = runPs(
      `Install-DroidHooks -SettingsPath .\\settings.json -StateDir .\\rel -BridgeUrl http://127.0.0.1:${PORT} -BridgeSecret ${SECRET}`,
      {},
      dir,
    );
    expect(install.code).toBe(0);
    expect(existsSync(join(dir, 'rel', 'bridge.json'))).toBe(true);
    const hooks = readJson(join(dir, 'settings.json')).hooks as Record<string, unknown>;
    const command = owned(hooks, 'Stop')[0].hooks[0].command;
    expect(command).toContain(join(dir, 'rel').replace(/\\/g, '/'));

    const received: Array<{ headers: IncomingMessage['headers']; body: string }> = [];
    await listen(received);
    const result = await runCommand(
      'cmd.exe',
      ['/d', '/s', '/c', command],
      JSON.stringify(sample),
      {},
      true,
      elsewhere,
    );
    expect(result.code).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0].headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it('embeds an absolute state dir when DROIDMOBILE_HELPER_HOME is relative', () => {
    const dir = scratch('pch-hook-');
    writeOriginal(dir);
    const install = runPs(
      `Install-DroidHooks -SettingsPath .\\settings.json`,
      { DROIDMOBILE_HELPER_HOME: '.\\home' },
      dir,
    );
    expect(install.code).toBe(0);
    const hooks = readJson(join(dir, 'settings.json')).hooks as Record<string, unknown>;
    const command = owned(hooks, 'Stop')[0].hooks[0].command;
    expect(command).toContain(`--state-dir "${join(dir, 'home').replace(/\\/g, '/')}"`);
  });
});

describe('Get-DroidDoctor failure modes (VAL-PCH-019, VAL-PCH-020)', () => {
  it('names Start-DroidDaemon and the bridge fix, exits non-zero, and writes nothing', () => {
    const dir = scratch('pch-doctor-');
    const file = writeOriginal(dir);
    const state = join(dir, 'state');
    mkdirSync(state);
    const before = sha(file);
    const r = runPs(
      `Doctor -DaemonPort 3108 -BridgeUrl http://127.0.0.1:3198 -SettingsPath '${file}' -StateDir '${state}'`,
      {
        FACTORY_API_KEY: 'fk-unit-test-key-0000000000000000',
        DROIDMOBILE_BRIDGE_SECRET: SECRET,
        DROIDMOBILE_DROID_EXE: fakeDroid(scratch('pch-droid-')),
      },
    );
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/\[PASS\] droid version: \d+\.\d+\.\d+/);
    expect(r.out).toMatch(/\[PASS\] Node version: v\d+/);
    expect(r.out).toMatch(/\[FAIL\] daemon health:/);
    expect(r.out).toMatch(/fix: Run Start-DroidDaemon -Port 3108/);
    expect(r.out).toMatch(/\[(FAIL|WARN)\] bridge reachability: .*3198/);
    expect(r.out).toMatch(/fix: Start the FCM bridge/);
    expect(r.out).toMatch(/Enable-TailscaleServe/);
    expect(r.out).not.toContain(SECRET);
    expect(r.out).not.toContain('fk-unit-test-key');
    expect(r.out).not.toMatch(/at <ScriptBlock>|System\.Management\.Automation/);
    expect(sha(file)).toBe(before);
    expect(readdirSync(state)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['settings.json', 'state']);
  }, 60_000);

  it('exposes the Doctor alias and checks the hooks state', () => {
    const dir = scratch('pch-doctor-');
    const file = writeOriginal(dir);
    const state = join(dir, 'state');
    runPs(
      `Install-DroidHooks -SettingsPath '${file}' -StateDir '${state}' -BridgeUrl http://127.0.0.1:3198 -BridgeSecret ${SECRET}`,
    );
    const r = runPs(
      `(Get-Alias Doctor).Definition; Doctor -DaemonPort 3108 -SettingsPath '${file}' -StateDir '${state}'`,
    );
    expect(r.out).toContain('Get-DroidDoctor');
    expect(r.out).toMatch(/\[PASS\] Droid hooks: Notification and Stop hooks installed/);
    expect(r.out).not.toContain(SECRET);
  }, 60_000);
});
