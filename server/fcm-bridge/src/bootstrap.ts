import { buildApp } from './app.js';
import { ConfigError, loadConfig, type BridgeConfig } from './config.js';
import { PairingVerifier } from './secret.js';
import { createFirebaseSender, dryRunSender, type Sender } from './sender.js';
import { DeviceStore } from './store.js';

const SHUTDOWN_TIMEOUT_MS = 4000;

async function start(config: BridgeConfig) {
  const sender: Sender = config.dryRun
    ? dryRunSender
    : await createFirebaseSender(config.serviceAccountPath as string);
  const store = await DeviceStore.open(config.dataDir);
  const verifier = new PairingVerifier(config.dataDir);
  const app = await buildApp({ config, store, verifier, sender });

  app.log.info(
    { mode: config.dryRun ? 'dry-run' : 'real-send', devices: store.size },
    config.dryRun
      ? 'mode: dry-run (no FCM calls are made)'
      : 'mode: real-send (messages are delivered through FCM)',
  );
  if (!(await verifier.isConfigured())) {
    app.log.warn(
      'no pairing secret yet: every /v1 request is rejected until you run generate-secret',
    );
  }

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await start(loadConfig(env, argv));
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`fcm-bridge: ${error.message}\n`);
    } else {
      const name = error instanceof Error ? error.name : 'Error';
      process.stderr.write(`fcm-bridge: failed to start (${name})\n`);
    }
    process.exit(1);
  }
}
