import { describe, expect, it } from 'vitest';
import {
  AuthError,
  ConnectionError,
  DaemonClientError,
  MethodUnavailableError,
  ProtocolError,
} from './errors';
import { classifyConnectFailure, classifyJsonRpcError } from './classify';

const KEY = 'fk-super-secret-key-value';

describe('classifyJsonRpcError', () => {
  it('classifies -32001 as an auth error with a key-specific message', () => {
    const result = classifyJsonRpcError({ code: -32001, message: 'Internal error' });
    expect(result.kind).toBe('auth');
    if (result.kind !== 'auth') throw new Error('unreachable');
    expect(result.error).toBeInstanceOf(AuthError);
    expect(result.error.message).toMatch(/api key/i);
    expect(result.error.message).not.toContain('Internal error');
    expect(result.error.message).not.toContain(KEY);
  });

  it('classifies -32601 with protocolVersionMismatch data as a version warning', () => {
    const result = classifyJsonRpcError(
      {
        code: -32601,
        message: 'Method not found: daemon.list_models',
        data: {
          protocolVersionMismatch: {
            localFactoryProtocolVersion: '1.201.1',
            peerFactoryProtocolVersion: '1.244.0',
          },
        },
      },
      'daemon.list_models',
    );
    expect(result.kind).toBe('version-warning');
    if (result.kind !== 'version-warning') throw new Error('unreachable');
    expect(result.warning.localFactoryProtocolVersion).toBe('1.201.1');
    expect(result.warning.peerFactoryProtocolVersion).toBe('1.244.0');
    expect(result.warning.method).toBe('daemon.list_models');
  });

  it('classifies -32001 as auth even when protocolVersionMismatch data is present', () => {
    const result = classifyJsonRpcError({
      code: -32001,
      message: 'Internal error',
      data: {
        protocolVersionMismatch: {
          localFactoryProtocolVersion: '1.201.1',
          peerFactoryProtocolVersion: '1.244.0',
        },
      },
    });
    expect(result.kind).toBe('auth');
  });

  it('accepts protocolVersionMismatch data nested directly in data', () => {
    const result = classifyJsonRpcError({
      code: -32601,
      message: 'Method not found',
      data: {
        localFactoryProtocolVersion: '1.201.1',
        peerFactoryProtocolVersion: '1.244.0',
      },
    });
    expect(result.kind).toBe('version-warning');
  });

  it('classifies plain -32601 as method-unavailable', () => {
    const result = classifyJsonRpcError({ code: -32601, message: 'Method not found: droid.foo' });
    expect(result.kind).toBe('method-unavailable');
    if (result.kind !== 'method-unavailable') throw new Error('unreachable');
    expect(result.error).toBeInstanceOf(MethodUnavailableError);
  });

  it('classifies parse and invalid-params codes as protocol errors', () => {
    for (const code of [-32700, -32602]) {
      const result = classifyJsonRpcError({ code, message: 'bad frame' });
      expect(result.kind).toBe('protocol');
      if (result.kind !== 'protocol') throw new Error('unreachable');
      expect(result.error).toBeInstanceOf(ProtocolError);
    }
  });

  it('classifies other codes as unknown daemon errors', () => {
    const result = classifyJsonRpcError({ code: -99999, message: 'boom' });
    expect(result.kind).toBe('unknown');
    if (result.kind !== 'unknown') throw new Error('unreachable');
    expect(result.error).toBeInstanceOf(DaemonClientError);
    expect(result.error.kind).toBe('unknown');
  });

  it('redacts api keys from every classified error message', () => {
    const leaked = `auth failed for ${KEY}`;
    for (const code of [-32001, -32601, -32700, -99999]) {
      const result = classifyJsonRpcError({ code, message: leaked });
      if (result.kind === 'version-warning') throw new Error('unexpected warning');
      expect(result.error.message).not.toContain(KEY);
      if (code !== -32001) {
        // The auth error uses a fixed key-specific message instead of echoing
        // the daemon text; all other kinds carry the (redacted) daemon text.
        expect(result.error.message).toContain('[REDACTED]');
      }
    }
  });
});

describe('classifyConnectFailure', () => {
  it('maps a JSON-RPC -32001 rejection carried in the cause chain to AuthError', () => {
    const rpcError = new Error('Internal error') as Error & { error?: { code: number; message: string } };
    rpcError.error = { code: -32001, message: 'Internal error' };
    const outer = new Error('Authentication failed', { cause: rpcError });
    const classified = classifyConnectFailure(outer);
    expect(classified).toBeInstanceOf(AuthError);
    expect(classified.message).toMatch(/api key/i);
    expect(classified.message).not.toContain('Internal error');
  });

  it('maps a ConnectionFailureError shaped reason auth_rejected to AuthError', () => {
    const failure = Object.assign(new Error('auth rejected'), { reason: 'auth_rejected', retryable: false });
    const classified = classifyConnectFailure(failure);
    expect(classified).toBeInstanceOf(AuthError);
  });

  it('maps transport-level failures to ConnectionError', () => {
    const classified = classifyConnectFailure(new Error('connect ECONNREFUSED 127.0.0.1:3199'));
    expect(classified).toBeInstanceOf(ConnectionError);
    expect(classified.kind).toBe('connection');
  });

  it('maps unknown non-error rejections to ConnectionError', () => {
    const classified = classifyConnectFailure(undefined);
    expect(classified).toBeInstanceOf(ConnectionError);
  });

  it('redacts keys found in underlying failure messages', () => {
    const classified = classifyConnectFailure(new Error(`handshake failed for ${KEY}`));
    expect(classified.message).not.toContain(KEY);
  });
});
