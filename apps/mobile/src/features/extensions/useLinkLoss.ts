import { useEffect, useRef } from 'react';
import { useConnectionStore } from '../../stores/connection';

/**
 * Calls `onLoss` each time the daemon link leaves `ready` while the screen is
 * mounted. A list read then fails visibly (error state with Retry) instead of
 * leaving rows on screen that the daemon can no longer confirm.
 */
export function useLinkLoss(onLoss: () => void): void {
  const handler = useRef(onLoss);
  handler.current = onLoss;
  useEffect(
    () =>
      useConnectionStore.subscribe((state, previous) => {
        if (previous.status === 'ready' && state.status !== 'ready') handler.current();
      }),
    [],
  );
}
