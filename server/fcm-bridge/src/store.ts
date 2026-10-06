import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './fsutil.js';

export const DEVICES_FILE = 'devices.json';

export interface DeviceRecord {
  deviceId: string;
  fcmToken: string;
  label: string;
  registeredAt: string;
  updatedAt: string;
}

interface StoreFile {
  version: 1;
  devices: DeviceRecord[];
}

export class StoreCorruptError extends Error {
  constructor() {
    super(`${DEVICES_FILE} exists but is not a valid device store; refusing to overwrite it`);
    this.name = 'StoreCorruptError';
  }
}

function isDeviceRecord(value: unknown): value is DeviceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceId === 'string' &&
    typeof v.fcmToken === 'string' &&
    typeof v.label === 'string' &&
    typeof v.registeredAt === 'string' &&
    typeof v.updatedAt === 'string'
  );
}

/**
 * Device registry persisted as one JSON file. Every mutation is applied to a copy,
 * written atomically, and only then committed, one at a time, so concurrent requests
 * never lose each other's changes and a failed write leaves memory and disk in sync.
 */
export class DeviceStore {
  private devices: Map<string, DeviceRecord>;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    devices: Map<string, DeviceRecord>,
  ) {
    this.devices = devices;
  }

  static async open(dataDir: string): Promise<DeviceStore> {
    await mkdir(dataDir, { recursive: true });
    const filePath = path.join(dataDir, DEVICES_FILE);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new DeviceStore(filePath, new Map());
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new StoreCorruptError();
    }
    const devices = (parsed as Partial<StoreFile> | null)?.devices;
    if (!Array.isArray(devices) || !devices.every(isDeviceRecord)) throw new StoreCorruptError();
    return new DeviceStore(filePath, new Map(devices.map((d) => [d.deviceId, d])));
  }

  list(): DeviceRecord[] {
    return [...this.devices.values()];
  }

  get size(): number {
    return this.devices.size;
  }

  async upsert(input: {
    deviceId: string;
    fcmToken: string;
    label: string;
  }): Promise<{ created: boolean }> {
    return this.mutate((draft) => {
      const now = new Date().toISOString();
      const existing = draft.get(input.deviceId);
      draft.set(input.deviceId, {
        deviceId: input.deviceId,
        fcmToken: input.fcmToken,
        label: input.label,
        registeredAt: existing?.registeredAt ?? now,
        updatedAt: now,
      });
      return { changed: true, value: { created: existing === undefined } };
    });
  }

  async remove(deviceId: string): Promise<boolean> {
    return this.mutate((draft) => {
      const removed = draft.delete(deviceId);
      return { changed: removed, value: removed };
    });
  }

  /** Removes the device only if it still holds `fcmToken`, so a fresh re-registration survives. */
  async removeIfToken(deviceId: string, fcmToken: string): Promise<boolean> {
    return this.mutate((draft) => {
      if (draft.get(deviceId)?.fcmToken !== fcmToken) return { changed: false, value: false };
      draft.delete(deviceId);
      return { changed: true, value: true };
    });
  }

  private mutate<T>(apply: (draft: Map<string, DeviceRecord>) => { changed: boolean; value: T }) {
    const run = this.queue.then(async () => {
      const draft = new Map(this.devices);
      const { changed, value } = apply(draft);
      if (changed) {
        const file: StoreFile = { version: 1, devices: [...draft.values()] };
        await writeFileAtomic(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
        this.devices = draft;
      }
      return value;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
