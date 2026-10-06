import { Capacitor, CapacitorHttp } from '@capacitor/core';

export type BridgeErrorKind =
  'unauthorized' | 'unreachable' | 'rejected' | 'rate-limited' | 'server';

/** A failed bridge call. Carries only a kind: never the response body, the secret or the token. */
export class BridgeError extends Error {
  readonly kind: BridgeErrorKind;

  constructor(kind: BridgeErrorKind) {
    super(`FCM bridge request failed: ${kind}`);
    this.name = 'BridgeError';
    this.kind = kind;
  }
}

export type BridgeUrlCheck =
  { ok: true; url: string } | { ok: false; reason: 'malformed' | 'insecure' };

/**
 * Accepts an http(s) origin (plus an optional path prefix) without credentials, query or hash.
 * Plain http is a debug-build convenience (emulator loopback); release requires https.
 */
export function checkBridgeUrl(raw: string, allowCleartext: boolean): BridgeUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const secure = parsed.protocol === 'https:';
  if (!secure && parsed.protocol !== 'http:') return { ok: false, reason: 'malformed' };
  if (parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'malformed' };
  }
  if (parsed.search !== '' || parsed.hash !== '') return { ok: false, reason: 'malformed' };
  if (!secure && !allowCleartext) return { ok: false, reason: 'insecure' };
  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.origin}${path}` };
}

export interface BridgeRequest {
  url: string;
  method: 'POST' | 'DELETE';
  headers: Record<string, string>;
  body?: unknown;
}

/** Resolves with the HTTP status; rejects only when no response arrived. */
export type BridgeTransport = (request: BridgeRequest) => Promise<{ status: number }>;

export const BRIDGE_TIMEOUT_MS = 8_000;

/**
 * Native HTTP on Android: the bridge is not a web origin of the app, so a WebView fetch would
 * need CORS and would be blocked as mixed content for a cleartext bridge. The platform's own
 * cleartext policy (debug only) still applies.
 */
export const defaultBridgeTransport: BridgeTransport = async (request) => {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: request.url,
      method: request.method,
      headers: request.headers,
      data: request.body,
      connectTimeout: BRIDGE_TIMEOUT_MS,
      readTimeout: BRIDGE_TIMEOUT_MS,
    });
    return { status: response.status };
  }
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  });
  return { status: response.status };
};

export interface BridgeTarget {
  /** Normalised by {@link checkBridgeUrl}. */
  bridge: string;
  secret: string;
}

export interface BridgeClient {
  register(
    target: BridgeTarget,
    device: { deviceId: string; fcmToken: string; label: string },
  ): Promise<void>;
  /** Resolves true when the bridge removed the device, false when it did not know it. */
  unregister(target: BridgeTarget, deviceId: string): Promise<boolean>;
}

function failureFor(status: number): BridgeError {
  if (status === 401) return new BridgeError('unauthorized');
  if (status === 429) return new BridgeError('rate-limited');
  if (status >= 500) return new BridgeError('server');
  return new BridgeError('rejected');
}

async function send(
  transport: BridgeTransport,
  request: BridgeRequest,
  timeoutMs: number,
): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new BridgeError('unreachable')), timeoutMs);
  });
  try {
    const { status } = await Promise.race([transport(request), timeout]);
    return status;
  } catch (error) {
    throw error instanceof BridgeError ? error : new BridgeError('unreachable');
  } finally {
    clearTimeout(timer);
  }
}

export function createBridgeClient(
  transport: BridgeTransport = defaultBridgeTransport,
  timeoutMs: number = BRIDGE_TIMEOUT_MS + 2_000,
): BridgeClient {
  const headers = (secret: string, json: boolean): Record<string, string> => ({
    Authorization: `Bearer ${secret}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  });
  return {
    async register(target, device) {
      const status = await send(
        transport,
        {
          url: `${target.bridge}/v1/devices`,
          method: 'POST',
          headers: headers(target.secret, true),
          body: device,
        },
        timeoutMs,
      );
      if (status !== 200 && status !== 201) throw failureFor(status);
    },
    async unregister(target, deviceId) {
      const status = await send(
        transport,
        {
          url: `${target.bridge}/v1/devices/${encodeURIComponent(deviceId)}`,
          method: 'DELETE',
          headers: headers(target.secret, false),
        },
        timeoutMs,
      );
      if (status === 204) return true;
      if (status === 404) return false;
      throw failureFor(status);
    },
  };
}

export const bridgeClient: BridgeClient = createBridgeClient();
