import { ConfigError, loadConfig } from './config.js';
import { generatePairingSecret, pairingFilePath, pairingSecretExists } from './secret.js';

const USAGE = 'usage: generate-secret [--rotate]';

/** Returns the process exit code. The secret is written to `out` once and nowhere else. */
export async function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  out: { write(text: string): unknown } = process.stdout,
  err: { write(text: string): unknown } = process.stderr,
): Promise<number> {
  const [command, ...flags] = argv;
  const rotate = flags.includes('--rotate');
  if (command !== 'generate-secret' || flags.some((f) => f !== '--rotate')) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  let dataDir: string;
  try {
    dataDir = loadConfig({ ...env, BRIDGE_DRY_RUN: '1' }).dataDir;
  } catch (error) {
    if (error instanceof ConfigError) {
      err.write(`fcm-bridge: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  if (!rotate && (await pairingSecretExists(dataDir))) {
    err.write(
      `A pairing secret already exists (${pairingFilePath(dataDir)}). It cannot be shown again; run with --rotate to replace it and invalidate the old one.\n`,
    );
    return 1;
  }
  const secret = await generatePairingSecret(dataDir);
  out.write(
    `Pairing secret (shown once, store it now; the bridge keeps only a salted hash):\n${secret}\n`,
  );
  return 0;
}
