import { normalizePairingInput, parsePairingCode } from '../connect/pairing';
import type { PairingPayload } from '../connect/pairing';
import { checkDaemonUrl } from '../connect/validation';

export type PairLinkError = 'invalid' | 'insecure';

export type PairLinkParse =
  | { kind: 'ignored' }
  | { kind: 'error'; error: PairLinkError }
  | { kind: 'link'; payload: PairingPayload };

/** What the confirmation dialog may show: hosts and a yes/no, never a secret. */
export interface PairLinkSummary {
  host: string;
  hasKey: boolean;
  bridgeHost: string | null;
}

const PAIR_HOST = /^droidmobile:\/\/pair(?=$|[?/#])/i;

/**
 * Classifies a URI delivered by Android. Only `droidmobile://pair` is ours; any
 * other URI is ignored without a message. A link needs the same payload as a
 * pairing code, and a release build additionally refuses `ws://`.
 */
export function parsePairLink(raw: string, allowCleartext: boolean): PairLinkParse {
  if (!PAIR_HOST.test(normalizePairingInput(raw.slice(0, 64)))) return { kind: 'ignored' };
  const payload = parsePairingCode(raw);
  if (payload === null) return { kind: 'error', error: 'invalid' };
  if (!checkDaemonUrl(payload.url, allowCleartext).ok) return { kind: 'error', error: 'insecure' };
  return { kind: 'link', payload };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function summarizePairLink(payload: PairingPayload): PairLinkSummary {
  return {
    host: hostOf(payload.url),
    hasKey: payload.key !== undefined,
    bridgeHost: payload.bridge === undefined ? null : hostOf(payload.bridge),
  };
}

/** Same daemon regardless of scheme: ws and wss cannot share one host and port. */
export function daemonIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
}
