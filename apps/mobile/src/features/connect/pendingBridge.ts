import { getSecureStore } from '../../platform/secureStore';
import { PENDING_BRIDGE_SECRET_ID } from './pairing';
import type { PairingPayload } from './pairing';

/** Parks the bridge half of a pairing payload in the secure store until a registration consumes it. */
export function stashPendingBridge(payload: PairingPayload): void {
  if (payload.bridge === undefined || payload.bridgeSecret === undefined) return;
  const bridge = JSON.stringify({ bridge: payload.bridge, bridgeSecret: payload.bridgeSecret });
  getSecureStore()
    .setSecret(PENDING_BRIDGE_SECRET_ID, bridge)
    .catch(() => undefined);
}
