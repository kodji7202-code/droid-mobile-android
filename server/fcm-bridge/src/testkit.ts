import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { Message } from 'firebase-admin/messaging';
import { buildApp, type AppDeps } from './app.js';
import { PairingVerifier, generatePairingSecret } from './secret.js';
import type { Sender } from './sender.js';
import { DeviceStore } from './store.js';

export interface Harness {
  app: Awaited<ReturnType<typeof buildApp>>;
  store: DeviceStore;
  dataDir: string;
  secret: string;
  sent: Message[];
  logLines: () => string[];
  auth: { authorization: string };
  close: () => Promise<void>;
}

export class StubSender implements Sender {
  readonly sent: Message[] = [];
  constructor(private readonly failures: Record<string, string> = {}) {}

  send(message: Message): Promise<void> {
    const token = (message as { token: string }).token;
    this.sent.push(message);
    const code = this.failures[token];
    if (code) return Promise.reject(Object.assign(new Error('simulated FCM failure'), { code }));
    return Promise.resolve();
  }
}

export async function createHarness(
  options: {
    sender?: Sender;
    config?: Partial<AppDeps['config']>;
    dataDir?: string;
  } = {},
): Promise<Harness> {
  const dataDir = options.dataDir ?? (await mkdtemp(path.join(tmpdir(), 'fcm-bridge-test-')));
  const secret = await generatePairingSecret(dataDir);
  const store = await DeviceStore.open(dataDir);
  const lines: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      callback();
    },
  });
  const stub = options.sender ?? new StubSender();
  const app = await buildApp({
    config: {
      dryRun: false,
      rateLimitMax: 1000,
      rateLimitWindowMs: 60_000,
      bodyLimitBytes: 65_536,
      trustProxy: false,
      logLevel: 'debug',
      ...options.config,
    },
    store,
    verifier: new PairingVerifier(dataDir),
    sender: stub,
    logStream,
  });
  await app.ready();
  return {
    app,
    store,
    dataDir,
    secret,
    sent: stub instanceof StubSender ? stub.sent : [],
    logLines: () => lines,
    auth: { authorization: `Bearer ${secret}` },
    close: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
