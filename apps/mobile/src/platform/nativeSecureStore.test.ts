import { describe, expect, it } from 'vitest';
import { createNativeSecureStore } from './nativeSecureStore';

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    get: (key: string) => Promise.resolve(data.get(key) ?? null),
    set: (key: string, value: unknown) => {
      data.set(key, String(value));
      return Promise.resolve();
    },
    remove: (key: string) => Promise.resolve(data.delete(key)),
  };
}

describe('createNativeSecureStore', () => {
  it('round-trips a secret through the plugin', async () => {
    const storage = fakeStorage();
    const store = createNativeSecureStore(storage);
    await store.setSecret('c1', 'fk-invalid-validation-probe');
    expect(await store.getSecret('c1')).toBe('fk-invalid-validation-probe');
    expect(storage.data.size).toBe(1);
  });

  it('returns null for a missing or empty entry', async () => {
    const storage = fakeStorage();
    const store = createNativeSecureStore(storage);
    expect(await store.getSecret('none')).toBeNull();
    storage.data.set('empty', '');
    expect(await store.getSecret('empty')).toBeNull();
  });

  it('deletes the entry', async () => {
    const storage = fakeStorage();
    const store = createNativeSecureStore(storage);
    await store.setSecret('c1', 'k');
    await store.deleteSecret('c1');
    expect(storage.data.size).toBe(0);
  });
});
