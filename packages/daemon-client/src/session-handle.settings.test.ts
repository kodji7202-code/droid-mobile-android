import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroidSession } from '@factory/droid-sdk';
import { SessionHandle } from './session-handle';
import type { SessionHost } from './session-handle';

function setup(initial: Record<string, unknown>) {
  const session = { id: 's', settings: initial, cwd: '/w' } as unknown as ConnectedDroidSession;
  const updateSettingsById = vi.fn(async () => {});
  const host = {
    currentDroidToken: () => 1,
    updateSettingsById,
  } as unknown as SessionHost;
  const handle = new SessionHandle('s', host);
  handle.attach(session, 1);
  return { handle, session, updateSettingsById };
}

describe('SessionHandle settings', () => {
  it('reads the SDK session settings live, not the copy taken at attach', () => {
    const { handle, session } = setup({ modelId: 'a', autonomyLevel: 'off' });
    (session as unknown as { settings: unknown }).settings = { modelId: 'b', autonomyLevel: 'low' };
    expect(handle.settingsSnapshot).toMatchObject({ modelId: 'b', autonomyLevel: 'low' });
  });

  it('shows an accepted change until a newer daemon notification replaces the settings', async () => {
    const { handle, session, updateSettingsById } = setup({ modelId: 'a', autonomyLevel: 'off' });
    await handle.applySettings({ autonomyLevel: 'high' });
    expect(updateSettingsById).toHaveBeenCalledWith('s', { autonomyLevel: 'high' });
    expect(handle.settingsSnapshot?.autonomyLevel).toBe('high');

    (session as unknown as { settings: unknown }).settings = {
      modelId: 'a',
      autonomyLevel: 'medium',
    };
    expect(handle.settingsSnapshot?.autonomyLevel).toBe('medium');
  });

  it('reads the context breakdown through the host for its own session id', async () => {
    const breakdown = { usedTokens: 1 };
    const host = {
      currentDroidToken: () => 1,
      getContextBreakdownById: vi.fn(async () => breakdown),
    } as unknown as SessionHost;
    const handle = new SessionHandle('s-ctx', host);
    handle.attach({ id: 's-ctx', settings: {}, cwd: '/w' } as unknown as ConnectedDroidSession, 1);
    await expect(handle.getContextBreakdown()).resolves.toBe(breakdown);
    expect(host.getContextBreakdownById).toHaveBeenCalledWith('s-ctx');
  });

  it('does not show a rejected change', async () => {
    const { handle, updateSettingsById } = setup({ autonomyLevel: 'off' });
    updateSettingsById.mockRejectedValueOnce(new Error('socket closed'));
    await expect(handle.applySettings({ autonomyLevel: 'high' })).rejects.toThrow('socket closed');
    expect(handle.settingsSnapshot?.autonomyLevel).toBe('off');
  });
});
