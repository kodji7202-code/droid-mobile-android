import type { FastifyBaseLogger } from 'fastify';
import { maskToken } from './mask.js';
import { buildMessage, type BridgeEventKind } from './payload.js';
import { errorCode, isStaleTokenError, type Sender } from './sender.js';
import type { DeviceStore } from './store.js';

export interface DispatchResult {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * Sends one opaque message per registered device. A failing device never affects the
 * others and never throws; devices whose token FCM reports as dead are dropped.
 */
export async function dispatchEvent(
  deps: { store: DeviceStore; sender: Sender; log: FastifyBaseLogger },
  event: { kind: BridgeEventKind; sessionId: string },
): Promise<DispatchResult> {
  const { store, sender, log } = deps;
  const outcomes = await Promise.all(
    store.list().map(async (device) => {
      try {
        await sender.send(buildMessage(device.fcmToken, event.kind, event.sessionId));
        return { ok: true as const, removed: false };
      } catch (error) {
        const code = errorCode(error);
        log.warn(
          { deviceId: device.deviceId, token: maskToken(device.fcmToken), errorCode: code },
          'push to device failed',
        );
        if (!isStaleTokenError(error)) return { ok: false as const, removed: false };
        let removed = false;
        try {
          removed = await store.removeIfToken(device.deviceId, device.fcmToken);
        } catch {
          log.error({ deviceId: device.deviceId }, 'could not remove stale device');
        }
        if (removed) {
          log.info(
            { deviceId: device.deviceId, token: maskToken(device.fcmToken), errorCode: code },
            'removed device with unregistered token',
          );
        }
        return { ok: false as const, removed };
      }
    }),
  );
  return {
    sent: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    removed: outcomes.filter((o) => o.removed).length,
  };
}
