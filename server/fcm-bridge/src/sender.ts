import { readFile } from 'node:fs/promises';
import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { ConfigError } from './config.js';

/** Hands one message to FCM; rejects with an error that may carry a `code`. */
export interface Sender {
  send(message: Message): Promise<void>;
}

/** Dry-run mode: nothing leaves the process, every message counts as handed over. */
export const dryRunSender: Sender = {
  send: () => Promise.resolve(),
};

const STALE_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}

export function isStaleTokenError(error: unknown): boolean {
  return STALE_TOKEN_CODES.has(errorCode(error));
}

/**
 * Reads and validates the service account without ever echoing its contents: parser
 * errors can quote the offending text, so only fixed messages are reported.
 */
export async function loadServiceAccount(filePath: string): Promise<ServiceAccount> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new ConfigError(['FIREBASE_SERVICE_ACCOUNT_PATH does not point to a readable file']);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(['FIREBASE_SERVICE_ACCOUNT_PATH does not contain valid JSON']);
  }
  const v = parsed as Record<string, unknown> | null;
  if (
    typeof v !== 'object' ||
    v === null ||
    typeof v.project_id !== 'string' ||
    typeof v.client_email !== 'string' ||
    typeof v.private_key !== 'string'
  ) {
    throw new ConfigError([
      'FIREBASE_SERVICE_ACCOUNT_PATH is not a Firebase service account key (project_id, client_email and private_key are required)',
    ]);
  }
  return { projectId: v.project_id, clientEmail: v.client_email, privateKey: v.private_key };
}

export async function createFirebaseSender(serviceAccountPath: string): Promise<Sender> {
  const serviceAccount = await loadServiceAccount(serviceAccountPath);
  let messaging: ReturnType<typeof getMessaging>;
  try {
    messaging = getMessaging(initializeApp({ credential: cert(serviceAccount) }, 'fcm-bridge'));
  } catch {
    throw new ConfigError(['FIREBASE_SERVICE_ACCOUNT_PATH holds a key Firebase cannot use']);
  }
  return {
    async send(message) {
      await messaging.send(message);
    },
  };
}
