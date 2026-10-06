import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const CWD = path.resolve('/work');

function load(env: Record<string, string>, argv: string[] = []) {
  return loadConfig(env, argv, CWD);
}

describe('loadConfig', () => {
  it('uses documented defaults in dry-run mode without a service account', () => {
    const config = load({ BRIDGE_DRY_RUN: '1' });
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 3102,
      dryRun: true,
      serviceAccountPath: undefined,
      rateLimitMax: 100,
      rateLimitWindowMs: 60_000,
      bodyLimitBytes: 65_536,
      trustProxy: false,
      logLevel: 'info',
    });
    expect(config.dataDir).toBe(path.join(CWD, 'data'));
  });

  it('reads PORT, BRIDGE_DATA_DIR and the service account path from the environment', () => {
    const config = load({
      PORT: '3109',
      BRIDGE_DATA_DIR: 'state',
      FIREBASE_SERVICE_ACCOUNT_PATH: 'sa.json',
    });
    expect(config.port).toBe(3109);
    expect(config.dataDir).toBe(path.join(CWD, 'state'));
    expect(config.serviceAccountPath).toBe(path.join(CWD, 'sa.json'));
    expect(config.dryRun).toBe(false);
  });

  it('lets --port and --dry-run override the environment', () => {
    const config = load({ PORT: '3109' }, ['--port', '3102', '--dry-run']);
    expect(config.port).toBe(3102);
    expect(config.dryRun).toBe(true);
    expect(load({ BRIDGE_DRY_RUN: '1' }, ['--port=3105']).port).toBe(3105);
  });

  it('fails fast in real-send mode without FIREBASE_SERVICE_ACCOUNT_PATH', () => {
    expect(() => load({})).toThrow(ConfigError);
    expect(() => load({})).toThrow(/FIREBASE_SERVICE_ACCOUNT_PATH/);
    expect(() => load({ FIREBASE_SERVICE_ACCOUNT_PATH: '   ' })).toThrow(
      /FIREBASE_SERVICE_ACCOUNT_PATH/,
    );
  });

  it('reports every invalid value by variable name', () => {
    let message = '';
    try {
      load({
        BRIDGE_DRY_RUN: 'maybe',
        PORT: '70000',
        BRIDGE_RATE_LIMIT_MAX: '0',
        BRIDGE_BODY_LIMIT_BYTES: 'big',
        BRIDGE_TRUST_PROXY: '2',
        BRIDGE_LOG_LEVEL: 'loud',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const name of [
      'BRIDGE_DRY_RUN',
      'PORT',
      'BRIDGE_RATE_LIMIT_MAX',
      'BRIDGE_BODY_LIMIT_BYTES',
      'BRIDGE_TRUST_PROXY',
      'BRIDGE_LOG_LEVEL',
    ]) {
      expect(message).toContain(name);
    }
  });

  it('caps the body limit at 1 MiB', () => {
    expect(() => load({ BRIDGE_DRY_RUN: '1', BRIDGE_BODY_LIMIT_BYTES: '1048577' })).toThrow(
      /BRIDGE_BODY_LIMIT_BYTES/,
    );
  });
});
