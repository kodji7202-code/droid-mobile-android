import { describe, expect, it } from 'vitest';
import type { McpServer } from '@droidmobile/daemon-client';
import { authHost, needsAuth, redactError, statusBadge } from './mcpStatus';

function server(overrides: Partial<McpServer>): McpServer {
  return {
    name: 's',
    status: 'connected',
    serverType: 'stdio',
    source: 'user',
    isManaged: false,
    ...overrides,
  };
}

describe('statusBadge', () => {
  it.each([
    ['connecting', 'mcp.status.connecting', 'info'],
    ['connected', 'mcp.status.connected', 'success'],
    ['disconnected', 'mcp.status.disconnected', 'neutral'],
    ['failed', 'mcp.status.failed', 'danger'],
    ['disabled', 'mcp.status.disabled', 'muted'],
  ])('maps %s to a labelled badge', (status, labelKey, tone) => {
    expect(statusBadge(server({ status }))).toEqual({ labelKey, tone });
  });

  it('renders a neutral badge with the raw value for an unknown status', () => {
    expect(statusBadge(server({ status: 'quantum' }))).toEqual({
      labelKey: null,
      label: 'quantum',
      tone: 'neutral',
    });
  });

  it('shows Authentication required for a server that cannot connect without sign-in', () => {
    expect(statusBadge(server({ status: 'failed', requiresAuth: true }))).toEqual({
      labelKey: 'mcp.status.authRequired',
      tone: 'warning',
    });
  });

  it('keeps disabled and connected servers on their own badge even when auth data is present', () => {
    expect(statusBadge(server({ status: 'disabled', requiresAuth: true })).labelKey).toBe(
      'mcp.status.disabled',
    );
    expect(statusBadge(server({ status: 'connected', requiresAuth: true })).labelKey).toBe(
      'mcp.status.connected',
    );
  });
});

describe('needsAuth', () => {
  it('is true only for a non-connected, enabled server that requires auth', () => {
    expect(needsAuth(server({ status: 'failed', requiresAuth: true }))).toBe(true);
    expect(needsAuth(server({ status: 'failed' }))).toBe(false);
    expect(needsAuth(server({ status: 'disabled', requiresAuth: true }))).toBe(false);
    expect(needsAuth(server({ status: 'connected', requiresAuth: true }))).toBe(false);
  });
});

describe('redactError', () => {
  it('hides URL credentials and secret-looking query values', () => {
    expect(redactError('connect https://me:pw@host/mcp?api_key=abc&x=1&state=zzz failed')).toBe(
      'connect https://***@host/mcp?api_key=***&x=1&state=*** failed',
    );
  });

  it('leaves ordinary messages unchanged', () => {
    expect(redactError('Failed to connect to MCP server')).toBe('Failed to connect to MCP server');
  });
});

describe('authHost', () => {
  it('returns the host without path or query', () => {
    expect(authHost('https://mcp.linear.app/authorize?state=abc&code_challenge=xyz')).toBe(
      'mcp.linear.app',
    );
  });

  it('returns null for a value that is not an http(s) URL', () => {
    expect(authHost('javascript:alert(1)')).toBeNull();
    expect(authHost('nonsense')).toBeNull();
  });
});
