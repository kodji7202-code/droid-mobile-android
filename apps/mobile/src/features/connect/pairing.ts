import { checkDaemonUrl, isApiKeyFormat } from './validation';

export interface PairingPayload {
  url: string;
  key?: string;
  bridge?: string;
  bridgeSecret?: string;
}

/** Holds bridge info from a pairing code until the FCM registration consumes it; never rendered. */
export const PENDING_BRIDGE_SECRET_ID = 'pairing.pendingBridge';

const PREFIX = 'droidmobile://pair?';
const MAX_LENGTH = 4096;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Parses `droidmobile://pair?v=1&url=...[&key=...][&bridge=...&bridgeSecret=...]`.
 * Returns null for anything that is not exactly that: unknown version,
 * repeated or unknown parameters, bad url/key, or half a bridge pair. The
 * transport policy is applied later, at connect time.
 */
export function parsePairingCode(text: string): PairingPayload | null {
  const trimmed = text.trim();
  if (trimmed.length > MAX_LENGTH || !trimmed.toLowerCase().startsWith(PREFIX)) return null;
  const params = new URLSearchParams(trimmed.slice(PREFIX.length));
  const allowed = new Set(['v', 'url', 'key', 'bridge', 'bridgeSecret']);
  const seen = new Set<string>();
  for (const name of params.keys()) {
    if (!allowed.has(name) || seen.has(name)) return null;
    seen.add(name);
  }
  if (params.get('v') !== '1') return null;

  const url = params.get('url');
  if (url === null || !checkDaemonUrl(url, true).ok) return null;
  const payload: PairingPayload = { url: url.trim() };

  const key = params.get('key');
  if (key !== null) {
    if (!isApiKeyFormat(key)) return null;
    payload.key = key.trim();
  }

  const bridge = params.get('bridge');
  const bridgeSecret = params.get('bridgeSecret');
  if ((bridge === null) !== (bridgeSecret === null)) return null;
  if (bridge !== null && bridgeSecret !== null) {
    if (!isHttpUrl(bridge) || bridgeSecret === '') return null;
    payload.bridge = bridge;
    payload.bridgeSecret = bridgeSecret;
  }
  return payload;
}
