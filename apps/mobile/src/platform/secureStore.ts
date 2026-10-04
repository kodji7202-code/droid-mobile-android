/**
 * Storage for API keys and other secrets, addressed by connection id. The web
 * implementation keeps them in memory only (WEB-KEY-RULE); the native
 * Keystore-backed implementation plugs in through {@link setSecureStore}.
 */
export interface SecureStore {
  getSecret(id: string): Promise<string | null>;
  setSecret(id: string, secret: string): Promise<void>;
  deleteSecret(id: string): Promise<void>;
}

/** Never touches localStorage, sessionStorage, IndexedDB or cookies. */
export function createMemorySecureStore(): SecureStore {
  const secrets = new Map<string, string>();
  return {
    getSecret: (id) => Promise.resolve(secrets.get(id) ?? null),
    setSecret: (id, secret) => {
      secrets.set(id, secret);
      return Promise.resolve();
    },
    deleteSecret: (id) => {
      secrets.delete(id);
      return Promise.resolve();
    },
  };
}

let current: SecureStore = createMemorySecureStore();

export function getSecureStore(): SecureStore {
  return current;
}

export function setSecureStore(store: SecureStore): void {
  current = store;
}
