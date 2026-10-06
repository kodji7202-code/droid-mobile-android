import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './command.js';
import { PairingVerifier, generatePairingSecret, pairingFilePath } from './secret.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'fcm-bridge-secret-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('pairing secret', () => {
  it('stores only a salted scrypt verifier, never the secret or its plain SHA-256', async () => {
    const secret = await generatePairingSecret(dataDir);
    const stored = await readFile(pairingFilePath(dataDir), 'utf8');
    const record = JSON.parse(stored) as { algorithm: string; salt: string; hash: string };

    expect(secret.length).toBeGreaterThanOrEqual(40);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain(createHash('sha256').update(secret).digest('hex'));
    expect(record.algorithm).toBe('scrypt');
    expect(record.salt.length).toBeGreaterThan(8);
    expect(record.hash).not.toBe(secret);
  });

  it('uses a fresh salt for every secret', async () => {
    await generatePairingSecret(dataDir);
    const first = JSON.parse(await readFile(pairingFilePath(dataDir), 'utf8')) as { salt: string };
    await generatePairingSecret(dataDir);
    const second = JSON.parse(await readFile(pairingFilePath(dataDir), 'utf8')) as {
      salt: string;
    };
    expect(first.salt).not.toBe(second.salt);
  });

  it('verifies the right secret and rejects wrong, empty and oversized ones', async () => {
    const secret = await generatePairingSecret(dataDir);
    const verifier = new PairingVerifier(dataDir);
    expect(await verifier.verify(secret)).toBe(true);
    expect(await verifier.verify(`${secret}x`)).toBe(false);
    expect(await verifier.verify('')).toBe(false);
    expect(await verifier.verify('a'.repeat(5000))).toBe(false);
  });

  it('rejects everything while no secret exists and picks up a secret created later', async () => {
    const verifier = new PairingVerifier(dataDir);
    expect(await verifier.verify('anything')).toBe(false);
    expect(await verifier.isConfigured()).toBe(false);
    const secret = await generatePairingSecret(dataDir);
    expect(await verifier.verify(secret)).toBe(true);
  });

  it('honours a rotated secret without a restart', async () => {
    const oldSecret = await generatePairingSecret(dataDir);
    const verifier = new PairingVerifier(dataDir);
    expect(await verifier.verify(oldSecret)).toBe(true);
    const newSecret = await generatePairingSecret(dataDir);
    expect(await verifier.verify(oldSecret)).toBe(false);
    expect(await verifier.verify(newSecret)).toBe(true);
  });
});

describe('generate-secret command', () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      sinks: {
        out: { write: (t: string) => out.push(t) },
        err: { write: (t: string) => err.push(t) },
      },
    };
  }

  it('prints the secret once, refuses to show it again and rotates only on request', async () => {
    const env = { BRIDGE_DATA_DIR: dataDir };
    const first = capture();
    expect(await runCli(['generate-secret'], env, first.sinks.out, first.sinks.err)).toBe(0);
    const printed = first.out.join('');
    const secret = printed.trim().split('\n').pop() as string;
    expect(await new PairingVerifier(dataDir).verify(secret)).toBe(true);
    expect(await readdir(dataDir)).toEqual(['pairing.json']);

    const second = capture();
    expect(await runCli(['generate-secret'], env, second.sinks.out, second.sinks.err)).toBe(1);
    expect(second.out.join('') + second.err.join('')).not.toContain(secret);
    expect(await new PairingVerifier(dataDir).verify(secret)).toBe(true);

    const third = capture();
    expect(
      await runCli(['generate-secret', '--rotate'], env, third.sinks.out, third.sinks.err),
    ).toBe(0);
    expect(await new PairingVerifier(dataDir).verify(secret)).toBe(false);
  });

  it('prints usage for an unknown command', async () => {
    const result = capture();
    expect(
      await runCli(['nope'], { BRIDGE_DATA_DIR: dataDir }, result.sinks.out, result.sinks.err),
    ).toBe(2);
    expect(result.err.join('')).toContain('usage');
  });
});
