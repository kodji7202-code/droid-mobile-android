import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './fsutil.js';

export const PAIRING_FILE = 'pairing.json';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

interface PairingRecord {
  version: 1;
  algorithm: 'scrypt';
  N: number;
  r: number;
  p: number;
  keyLength: number;
  salt: string;
  hash: string;
  createdAt: string;
}

function deriveKey(secret: string, salt: Buffer, options: ScryptOptions, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(secret, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export function pairingFilePath(dataDir: string) {
  return path.join(dataDir, PAIRING_FILE);
}

export async function pairingSecretExists(dataDir: string): Promise<boolean> {
  try {
    await stat(pairingFilePath(dataDir));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Creates a new pairing secret and persists only a salted scrypt verifier. The plain
 * secret is returned to the caller exactly once and exists nowhere on disk.
 */
export async function generatePairingSecret(dataDir: string): Promise<string> {
  const secret = randomBytes(32).toString('base64url');
  const salt = randomBytes(16);
  const hash = await deriveKey(secret, salt, SCRYPT_PARAMS, KEY_LENGTH);
  const record: PairingRecord = {
    version: 1,
    algorithm: 'scrypt',
    ...SCRYPT_PARAMS,
    keyLength: KEY_LENGTH,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    createdAt: new Date().toISOString(),
  };
  await writeFileAtomic(pairingFilePath(dataDir), `${JSON.stringify(record, null, 2)}\n`);
  return secret;
}

function isRecord(value: unknown): value is PairingRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    v.algorithm === 'scrypt' &&
    typeof v.N === 'number' &&
    typeof v.r === 'number' &&
    typeof v.p === 'number' &&
    typeof v.keyLength === 'number' &&
    typeof v.salt === 'string' &&
    typeof v.hash === 'string'
  );
}

/**
 * Verifies presented secrets against the stored verifier. The file is re-read when it
 * changes, so rotating the secret with the CLI takes effect without a restart.
 */
export class PairingVerifier {
  private cached: { signature: string; record: PairingRecord | null } | undefined;

  constructor(private readonly dataDir: string) {}

  private async load(): Promise<PairingRecord | null> {
    const file = pairingFilePath(this.dataDir);
    let signature: string;
    try {
      const info = await stat(file);
      signature = `${info.mtimeMs}:${info.size}`;
    } catch {
      this.cached = undefined;
      return null;
    }
    if (this.cached?.signature === signature) return this.cached.record;
    let record: PairingRecord | null = null;
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (isRecord(parsed)) record = parsed;
    } catch {
      record = null;
    }
    this.cached = { signature, record };
    return record;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  async verify(presented: string): Promise<boolean> {
    const record = await this.load();
    if (!record || presented.length === 0 || presented.length > 512) return false;
    const expected = Buffer.from(record.hash, 'base64');
    const actual = await deriveKey(
      presented,
      Buffer.from(record.salt, 'base64'),
      { N: record.N, r: record.r, p: record.p },
      record.keyLength,
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
