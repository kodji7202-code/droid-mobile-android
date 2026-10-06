import type { McpServer } from '@droidmobile/daemon-client';

export type BadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'muted';

export type StatusBadge =
  { labelKey: string; tone: BadgeTone } | { labelKey: null; label: string; tone: 'neutral' };

const BADGES: Readonly<Record<string, { labelKey: string; tone: BadgeTone }>> = {
  connecting: { labelKey: 'mcp.status.connecting', tone: 'info' },
  connected: { labelKey: 'mcp.status.connected', tone: 'success' },
  disconnected: { labelKey: 'mcp.status.disconnected', tone: 'neutral' },
  failed: { labelKey: 'mcp.status.failed', tone: 'danger' },
  disabled: { labelKey: 'mcp.status.disabled', tone: 'muted' },
};

/**
 * The daemon reports `failed` + requiresAuth for an OAuth server that has no
 * valid token; a server that is off or already connected never needs sign-in.
 */
export function needsAuth(server: McpServer): boolean {
  return (
    server.requiresAuth === true && server.status !== 'connected' && server.status !== 'disabled'
  );
}

export function statusBadge(server: McpServer): StatusBadge {
  if (needsAuth(server)) return { labelKey: 'mcp.status.authRequired', tone: 'warning' };
  const known = Object.hasOwn(BADGES, server.status) ? BADGES[server.status] : undefined;
  return known ?? { labelKey: null, label: server.status, tone: 'neutral' };
}

const SECRET_QUERY =
  /([?&](?:[^=&\s]*(?:token|key|secret|password|code|state|auth)[^=&\s]*)=)[^&\s]*/gi;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;

/** Daemon error text can echo the configured URL; keep credentials and token values out of the UI. */
export function redactError(text: string): string {
  return text.replace(URL_CREDENTIALS, '$1***@').replace(SECRET_QUERY, '$1***');
}

/** Host of an authorization page; the query (state, code_challenge) is never surfaced. */
export function authHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : null;
  } catch {
    return null;
  }
}
