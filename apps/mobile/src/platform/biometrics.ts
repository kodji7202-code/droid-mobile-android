import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryErrorType } from '@aparajita/capacitor-biometric-auth';

export type BiometricOutcome = 'success' | 'cancelled' | 'failed' | 'unavailable';

export interface BiometricApi {
  /** True when a biometric is enrolled or a screen lock (PIN, pattern, password) is set. */
  isAvailable(): Promise<boolean>;
  authenticate(reason: string, cancelTitle: string): Promise<BiometricOutcome>;
}

type PluginSubset = Pick<typeof BiometricAuth, 'checkBiometry' | 'authenticate'>;

const CANCEL_CODES: readonly string[] = [
  BiometryErrorType.userCancel,
  BiometryErrorType.appCancel,
  BiometryErrorType.systemCancel,
  BiometryErrorType.userFallback,
];

const UNAVAILABLE_CODES: readonly string[] = [
  BiometryErrorType.biometryNotAvailable,
  BiometryErrorType.biometryNotEnrolled,
  BiometryErrorType.passcodeNotSet,
  BiometryErrorType.noDeviceCredential,
];

/**
 * Biometric prompt with device-credential fallback, so a PIN/pattern/password
 * unlocks the app when no fingerprint or face is enrolled. The web build has
 * no secure hardware: it reports unavailable and never claims success.
 */
export function createBiometrics(
  plugin: PluginSubset = BiometricAuth,
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): BiometricApi {
  return {
    async isAvailable() {
      if (!isNative()) return false;
      try {
        const info = await plugin.checkBiometry();
        return info.isAvailable || info.deviceIsSecure;
      } catch {
        return false;
      }
    },
    async authenticate(reason, cancelTitle) {
      if (!isNative()) return 'unavailable';
      try {
        await plugin.authenticate({
          reason,
          cancelTitle,
          allowDeviceCredential: true,
        });
        return 'success';
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (typeof code === 'string') {
          if (CANCEL_CODES.includes(code)) return 'cancelled';
          if (UNAVAILABLE_CODES.includes(code)) return 'unavailable';
        }
        return 'failed';
      }
    },
  };
}

export const biometrics: BiometricApi = createBiometrics();
