export type UrlCheck = { ok: true; url: string } | { ok: false; reason: 'malformed' | 'insecure' };

/**
 * Validates a daemon address and applies the transport policy: only ws/wss
 * with a host and no embedded credentials, and release builds accept wss
 * only. Runs before any socket is constructed.
 */
export function checkDaemonUrl(raw: string, allowCleartext: boolean): UrlCheck {
  const url = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const isWs = parsed.protocol === 'ws:';
  if ((!isWs && parsed.protocol !== 'wss:') || parsed.hostname === '') {
    return { ok: false, reason: 'malformed' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'malformed' };
  }
  if (isWs && !allowCleartext) return { ok: false, reason: 'insecure' };
  return { ok: true, url };
}

/** True while the text being typed is a cleartext ws:// address. */
export function isCleartextUrl(raw: string): boolean {
  return /^\s*ws:\/\//i.test(raw);
}

const API_KEY_FORMAT = /^fk-[A-Za-z0-9_-]{8,}$/;

/** Syntax check only; the daemon decides whether the key is accepted. */
export function isApiKeyFormat(key: string): boolean {
  return API_KEY_FORMAT.test(key.trim());
}
