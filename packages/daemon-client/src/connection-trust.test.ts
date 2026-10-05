import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  connectToDaemon: vi.fn(),
}));

vi.mock('@factory/droid-sdk', () => ({ connectToDaemon: sdk.connectToDaemon }));

import { createDaemonConnection } from './connection';

function trustState(isTrusted: boolean) {
  return { isTrusted, promptRequired: !isTrusted, trustRootPath: '/work' };
}

async function connectedWith(checkTrust: ReturnType<typeof vi.fn>) {
  const trust = vi.fn().mockResolvedValue(undefined);
  sdk.connectToDaemon.mockResolvedValue({
    disconnect: vi.fn(),
    sessions: { list: vi.fn().mockResolvedValue([]) },
    workspace: { trust, checkTrust },
  });
  const connection = createDaemonConnection({
    url: 'ws://127.0.0.1:1',
    apiKey: 'fk-test',
    backoff: { initialMs: 1, maxMs: 2, jitterFraction: 0 },
    keepAliveMs: 0,
  });
  await connection.connect();
  return { connection, trust };
}

describe('trustFolder (VAL-WS-006)', () => {
  beforeEach(() => {
    sdk.connectToDaemon.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves only once checkTrust reports the folder as trusted', async () => {
    const checkTrust = vi
      .fn()
      .mockResolvedValueOnce(trustState(false))
      .mockResolvedValueOnce(trustState(false))
      .mockResolvedValue(trustState(true));
    const { connection, trust } = await connectedWith(checkTrust);

    await connection.trustFolder('/work');

    expect(trust).toHaveBeenCalledWith('/work');
    expect(checkTrust).toHaveBeenCalledTimes(3);
  });

  it('resolves after the cap when the folder never becomes visibly trusted', async () => {
    const checkTrust = vi.fn().mockResolvedValue(trustState(false));
    const { connection } = await connectedWith(checkTrust);
    vi.useFakeTimers();

    let settled = false;
    const pending = connection.trustFolder('/work').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(settled).toBe(true);
    expect(checkTrust.mock.calls.length).toBeGreaterThan(3);
  });

  it('does not fail the trust when the visibility probe itself fails', async () => {
    const checkTrust = vi.fn().mockRejectedValue(new Error('probe failed'));
    const { connection } = await connectedWith(checkTrust);
    vi.useFakeTimers();

    const pending = connection.trustFolder('/work');
    await vi.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toBeUndefined();
  });
});
