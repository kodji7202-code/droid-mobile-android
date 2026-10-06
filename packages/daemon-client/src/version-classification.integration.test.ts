/**
 * VAL-ONBOARD-036: a version-mismatch error from the daemon is classified as
 * a non-blocking warning (not an auth error), while a separately
 * authenticated connection stays ready; a wrong-key daemon.authenticate is
 * classified as AuthError even though it carries the same
 * protocolVersionMismatch data.
 *
 * Runs against the real daemon (127.0.0.1:3101) with raw WebSocket frames,
 * mirroring the contract's verified shapes.
 */
import { describe, expect, it } from 'vitest';
import { classifyJsonRpcError } from './classify';
import { probeDaemonIdentity } from './probe';
import { createDaemonConnection } from './connection';

const DAEMON_URL = 'ws://127.0.0.1:3101';
// The SDK 0.9.1 protocol constant (FACTORY_PROTOCOL_VERSION).
const SDK_PROTOCOL_VERSION = '1.201.1';
const API_KEY = process.env.FACTORY_API_KEY;
const PROBE_KEY = 'fk-invalid-validation-probe';

if (!API_KEY) {
  throw new Error(
    'FACTORY_API_KEY is not set. Integration tests run against the real daemon: load .env.local first.',
  );
}

interface RpcFrame {
  id?: string | number | null;
  type?: string;
  method?: string;
  factoryProtocolVersion?: string;
  result?: unknown;
  error?: { code: number; message?: string; data?: unknown };
}

/** Opens a raw WebSocket, sends one request frame, and returns the response. */
function rawRpcRequest(
  url: string,
  frame: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<RpcFrame> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`no response within ${timeoutMs}ms`));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(frame));
    });
    ws.addEventListener('message', (event) => {
      let parsed: RpcFrame;
      try {
        parsed = JSON.parse(String(event.data)) as RpcFrame;
      } catch {
        return;
      }
      if (parsed.id !== frame.id) return;
      clearTimeout(timer);
      ws.close();
      resolve(parsed);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket failed'));
    });
  });
}

function requestFrame(id: string, method: string, params: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'request',
    jsonrpc: '2.0',
    factoryApiVersion: '1.0.0',
    factoryProtocolVersion: SDK_PROTOCOL_VERSION,
    id,
    method,
    params,
  };
}

describe('version-mismatch classification (VAL-ONBOARD-036)', () => {
  it('classifies the daemon -32601 protocolVersionMismatch response as a version warning, not auth', async () => {
    // A separately authenticated connection stays ready throughout.
    const conn = createDaemonConnection({ url: DAEMON_URL, apiKey: API_KEY });
    await conn.connect();

    // Pre-authentication daemon.list_models with the SDK's old protocol version.
    const response = await rawRpcRequest(
      DAEMON_URL,
      requestFrame('val-036-list-models', 'daemon.list_models', {}),
    );
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32601);
    const mismatch = (response.error?.data as { protocolVersionMismatch?: unknown })?.protocolVersionMismatch;
    expect(mismatch, 'daemon must report data.protocolVersionMismatch').toBeTruthy();

    const classified = classifyJsonRpcError(response.error!, 'daemon.list_models');
    expect(classified.kind).toBe('version-warning');
    if (classified.kind !== 'version-warning') throw new Error('unreachable');
    expect(classified.warning.peerFactoryProtocolVersion).toMatch(/^\d+\.\d+\.\d+$/);

    // The separate connection is untouched by the mismatch.
    expect(conn.getStatus()).toBe('ready');
    conn.disconnect();
  });

  it('classifies a wrong-key daemon.authenticate as AuthError, not a version warning', async () => {
    const response = await rawRpcRequest(
      DAEMON_URL,
      requestFrame('val-036-wrong-key', 'daemon.authenticate', { apiKey: PROBE_KEY, caller: 'droid-mobile' }),
    );
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32001);

    const classified = classifyJsonRpcError(response.error!, 'daemon.authenticate');
    expect(classified.kind).toBe('auth');
    if (classified.kind !== 'auth') throw new Error('unreachable');
    expect(classified.error.message).toMatch(/api key/i);
    expect(classified.error.message).not.toContain('Internal error');
    expect(classified.error.message).not.toContain(PROBE_KEY);
  });

  it('reports the daemon protocol version from the authenticate envelope', async () => {
    const identity = await probeDaemonIdentity(DAEMON_URL, API_KEY);
    const raw = await rawRpcRequest(
      DAEMON_URL,
      requestFrame('val-036-identity', 'daemon.authenticate', { apiKey: API_KEY, caller: 'droid-mobile' }),
    );
    expect(raw.factoryProtocolVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(identity.daemonProtocolVersion).toBe(raw.factoryProtocolVersion);
  });

  it('reports the daemon version announced after authenticate', async () => {
    const identity = await probeDaemonIdentity(DAEMON_URL, API_KEY);
    expect(identity.daemonVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
