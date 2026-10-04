import { describe, expect, it, vi } from 'vitest';
import { createBiometrics } from './biometrics';

function plugin(overrides: { check?: unknown; authenticate?: () => Promise<void> } = {}) {
  const authenticate = vi.fn(overrides.authenticate ?? (() => Promise.resolve()));
  return {
    checkBiometry: vi.fn(() =>
      Promise.resolve(overrides.check ?? { isAvailable: false, deviceIsSecure: false }),
    ),
    authenticate,
  } as unknown as Parameters<typeof createBiometrics>[0] & { authenticate: typeof authenticate };
}

const native = () => true;

describe('createBiometrics', () => {
  it('is available with an enrolled biometric or a screen lock, not with neither', async () => {
    expect(await createBiometrics(plugin(), native).isAvailable()).toBe(false);
    expect(
      await createBiometrics(
        plugin({ check: { isAvailable: false, deviceIsSecure: true } }),
        native,
      ).isAvailable(),
    ).toBe(true);
    expect(
      await createBiometrics(
        plugin({ check: { isAvailable: true, deviceIsSecure: false } }),
        native,
      ).isAvailable(),
    ).toBe(true);
  });

  it('never claims availability or success on the web', async () => {
    const api = createBiometrics(plugin({ check: { isAvailable: true } }), () => false);
    expect(await api.isAvailable()).toBe(false);
    expect(await api.authenticate('r', 'c')).toBe('unavailable');
  });

  it('allows the device credential and maps success', async () => {
    const p = plugin();
    expect(await createBiometrics(p, native).authenticate('why', 'Cancel')).toBe('success');
    expect(p.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ allowDeviceCredential: true, reason: 'why' }),
    );
  });

  it('passes the localized title as the Android prompt title', async () => {
    const p = plugin();
    await createBiometrics(p, native).authenticate('why', 'Anulează', 'Confirmă identitatea');
    expect(p.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ androidTitle: 'Confirmă identitatea', cancelTitle: 'Anulează' }),
    );
  });

  it.each([
    ['userCancel', 'cancelled'],
    ['systemCancel', 'cancelled'],
    ['authenticationFailed', 'failed'],
    ['biometryLockout', 'failed'],
    ['biometryNotEnrolled', 'unavailable'],
    ['noDeviceCredential', 'unavailable'],
  ])('maps error code %s to %s', async (code, outcome) => {
    const api = createBiometrics(
      plugin({ authenticate: () => Promise.reject(Object.assign(new Error('x'), { code })) }),
      native,
    );
    expect(await api.authenticate('r', 'c')).toBe(outcome);
  });

  it('treats an unknown rejection as a failure', async () => {
    const api = createBiometrics(
      plugin({ authenticate: () => Promise.reject(new Error('boom')) }),
      native,
    );
    expect(await api.authenticate('r', 'c')).toBe('failed');
  });
});
