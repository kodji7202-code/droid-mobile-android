import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { SecureStore } from './secureStore';

/** Keystore-backed store; entries are AES-GCM encrypted by the plugin's Android Keystore master key. */
export function createNativeSecureStore(
  storage: Pick<typeof SecureStorage, 'get' | 'set' | 'remove'> = SecureStorage,
): SecureStore {
  return {
    async getSecret(id) {
      // convertDate=false keeps a secret that looks like an ISO date a plain string.
      const value = await storage.get(id, false);
      return typeof value === 'string' && value !== '' ? value : null;
    },
    async setSecret(id, secret) {
      await storage.set(id, secret, false);
    },
    async deleteSecret(id) {
      await storage.remove(id);
    },
  };
}
