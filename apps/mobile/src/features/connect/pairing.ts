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

// \s already covers NBSP, BOM and the Unicode space separators; the rest are zero-width
// characters and the soft hyphen that terminals and chat apps inject into wrapped text.
const INVISIBLE = /[\s\u00AD\u200B-\u200F\u2060\uFEFF]+/g;
const WRAPPERS = /^[<>"'`\u00AB\u00BB\u2018-\u201F]+|[<>"'`\u00AB\u00BB\u2018-\u201F]+$/g;

/**
 * Turns whatever text reached an entry path (paste field, clipboard, QR, image,
 * deep link) into the compact one-line code. A valid pairing code never contains
 * whitespace because every value is percent-encoded, so removing all of it and
 * the quotes or angle brackets around the code is lossless.
 */
export function normalizePairingInput(text: string): string {
  return text.replace(INVISIBLE, '').replace(WRAPPERS, '');
}

/**
 * Parses `droidmobile://pair?v=1&url=...[&key=...][&bridge=...&bridgeSecret=...]`.
 * Returns null for anything that is not exactly that: unknown version,
 * repeated or unknown parameters, bad url/key, or half a bridge pair. The
 * transport policy is applied later, at connect time.
 */
export function parsePairingCode(text: string): PairingPayload | null {
  const trimmed = normalizePairingInput(text);
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
