/**
 * One-shot daemon identity probe over a raw WebSocket. Used on demand (e.g.
 * Settings > About) to read userId/orgId and the daemon-reported protocol
 * version from the `daemon.authenticate` reply envelope, which the SDK facade
 * does not expose. Reachability is always checked by WebSocket connect, never
 * by fetching /health (the daemon sends no CORS headers). Never logs frames.
 */
import { classifyJsonRpcError } from './classify';
import { ConnectionError } from './errors';
import { redactSecrets } from './redact';

export interface DaemonIdentity {
  userId: string;
  orgId: string;
  /** `factoryProtocolVersion` of the daemon's reply envelope (e.g. "1.244.0"). */
  daemonProtocolVersion?: string;
}

/** The protocol version the SDK 0.9.1 build speaks. */
export const SDK_FACTORY_PROTOCOL_VERSION = '1.201.1';
const FACTORY_API_VERSION = '1.0.0';

interface Envelope {
  id?: string | number | null;
  type?: string;
  factoryProtocolVersion?: string;
  result?: { userId?: unknown; orgId?: unknown };
  error?: { code: number; message?: string; data?: unknown };
}

function assertWsUrl(url: string): void {
  if (!/^wss?:\/\//.test(url)) {
    throw new ConnectionError('The daemon URL must use ws:// or wss://.');
  }
}

export async function probeDaemonIdentity(
  url: string,
  apiKey: string,
  options?: { timeoutMs?: number },
): Promise<DaemonIdentity> {
  assertWsUrl(url);
  const timeoutMs = options?.timeoutMs ?? 10_000;

  return await new Promise<DaemonIdentity>((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    let requestId = '';
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      reject(err);
    };
    const timer = setTimeout(() => fail(new ConnectionError(`Timed out reaching the daemon at ${redactSecrets(url)}.`)), timeoutMs);
    ws.addEventListener('error', () => fail(new ConnectionError(`Could not reach the daemon at ${redactSecrets(url)}.`)));
    ws.addEventListener('open', () => {
      requestId = `probe-${Date.now()}`;
      ws.send(
        JSON.stringify({
          type: 'request',
          jsonrpc: '2.0',
          factoryApiVersion: FACTORY_API_VERSION,
          factoryProtocolVersion: SDK_FACTORY_PROTOCOL_VERSION,
          id: requestId,
          method: 'daemon.authenticate',
          params: { apiKey, caller: 'droid-mobile' },
        }),
      );
    });
    ws.addEventListener('message', (event) => {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(String(event.data)) as Envelope;
      } catch {
        return fail(new ConnectionError('The endpoint is not a daemon (unparseable frame).'));
      }
      if (envelope.id !== requestId) return;
      if (envelope.error) {
        const classified = classifyJsonRpcError(envelope.error, 'daemon.authenticate');
        if (classified.kind === 'version-warning') {
          return fail(new ConnectionError('The daemon speaks a different protocol version than this client.'));
        }
        return fail(classified.error);
      }
      const userId = envelope.result?.userId;
      const orgId = envelope.result?.orgId;
      if (typeof userId !== 'string' || typeof orgId !== 'string') {
        return fail(new ConnectionError('The daemon authenticate reply was incomplete.'));
      }
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve({
        userId,
        orgId,
        daemonProtocolVersion: envelope.factoryProtocolVersion,
      });
    });
  });
}
