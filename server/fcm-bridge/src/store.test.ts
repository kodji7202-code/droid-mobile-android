import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVICES_FILE, DeviceStore, StoreCorruptError } from './store.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'fcm-bridge-store-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('DeviceStore', () => {
  it('replaces the token for an existing deviceId and keeps the registration time', async () => {
    const store = await DeviceStore.open(dataDir);
    expect(await store.upsert({ deviceId: 'a', fcmToken: 't1', label: 'one' })).toEqual({
      created: true,
    });
    const first = store.list()[0]!;
    expect(await store.upsert({ deviceId: 'a', fcmToken: 't2', label: 'two' })).toEqual({
      created: false,
    });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ fcmToken: 't2', label: 'two' });
    expect(store.list()[0]!.registeredAt).toBe(first.registeredAt);
  });

  it('keeps all 20 devices when registrations run concurrently and reloads them', async () => {
    const store = await DeviceStore.open(dataDir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.upsert({ deviceId: `device-${i}`, fcmToken: `token-${i}`, label: '' }),
      ),
    );
    expect(store.size).toBe(20);
    const reopened = await DeviceStore.open(dataDir);
    expect(reopened.size).toBe(20);
    expect(await readdir(dataDir)).toEqual([DEVICES_FILE]);
  });

  it('removeIfToken leaves a device that re-registered with a new token', async () => {
    const store = await DeviceStore.open(dataDir);
    await store.upsert({ deviceId: 'a', fcmToken: 'old', label: '' });
    await store.upsert({ deviceId: 'a', fcmToken: 'new', label: '' });
    expect(await store.removeIfToken('a', 'old')).toBe(false);
    expect(await store.removeIfToken('a', 'new')).toBe(true);
    expect(store.size).toBe(0);
  });

  it('remove reports whether the device existed', async () => {
    const store = await DeviceStore.open(dataDir);
    await store.upsert({ deviceId: 'a', fcmToken: 't', label: '' });
    expect(await store.remove('a')).toBe(true);
    expect(await store.remove('a')).toBe(false);
  });

  it('refuses to start on a corrupt store and leaves the file untouched', async () => {
    const file = path.join(dataDir, DEVICES_FILE);
    await writeFile(file, '{ not json');
    await expect(DeviceStore.open(dataDir)).rejects.toBeInstanceOf(StoreCorruptError);
    await writeFile(file, JSON.stringify({ version: 1, devices: [{ deviceId: 1 }] }));
    await expect(DeviceStore.open(dataDir)).rejects.toBeInstanceOf(StoreCorruptError);
    expect(await readFile(file, 'utf8')).toContain('"deviceId":1');
  });
});
