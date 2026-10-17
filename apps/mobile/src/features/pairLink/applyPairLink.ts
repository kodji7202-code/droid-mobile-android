import { MissingKeyError, useConnectionStore } from '../../stores/connection';
import { messageKeyFor } from '../connect/errors';
import { stashPendingBridge } from '../connect/pendingBridge';
import type { PairingPayload } from '../connect/pairing';
import { daemonIdentity } from './pairLink';
import { usePairLinkStore } from './pairLinkStore';

export type PairLinkOutcome =
  | { kind: 'connect-screen' }
  | { kind: 'add-form' }
  | { kind: 'switched' | 'added' | 'updated'; host: string }
  | { kind: 'error'; messageKey: string };

function failure(error: unknown): PairLinkOutcome {
  return {
    kind: 'error',
    messageKey:
      error instanceof MissingKeyError ? 'connections.errorMissingKey' : messageKeyFor(error),
  };
}

/**
 * Runs after the user confirmed a link. Without a connection the Connect screen applies it
 * through its normal connect path. With one, the link adds or updates a saved connection and
 * switches to it, so an existing daemon is never dropped before the new one authenticated.
 */
export async function applyPairLink(payload: PairingPayload): Promise<PairLinkOutcome> {
  const connections = useConnectionStore.getState();
  if (connections.connection === null) {
    usePairLinkStore.getState().handOffToConnect(payload);
    return { kind: 'connect-screen' };
  }

  const host = new URL(payload.url).host;
  const identity = daemonIdentity(payload.url);
  const existing = connections.savedConnections.find(
    (entry) => daemonIdentity(entry.url) === identity,
  );

  try {
    if (existing) {
      if (payload.key !== undefined) {
        await connections.updateConnection(existing.id, {
          label: existing.label,
          url: payload.url,
          apiKey: payload.key,
        });
      }
      await connections.switchTo(existing.id);
      stashPendingBridge(payload);
      return { kind: payload.key === undefined ? 'switched' : 'updated', host };
    }
    if (payload.key === undefined) {
      stashPendingBridge(payload);
      usePairLinkStore.getState().handOffToAddForm(payload.url);
      return { kind: 'add-form' };
    }
    const entry = await connections.addConnection({
      label: '',
      url: payload.url,
      apiKey: payload.key,
    });
    await connections.switchTo(entry.id);
    stashPendingBridge(payload);
    return { kind: 'added', host };
  } catch (error) {
    return failure(error);
  }
}
