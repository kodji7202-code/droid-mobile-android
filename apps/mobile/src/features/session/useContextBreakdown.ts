import { useCallback, useEffect, useState } from 'react';
import type { ContextBreakdown, SessionHandle } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';

export type ContextState =
  { status: 'loading' } | { status: 'ready'; data: ContextBreakdown } | { status: 'error' };

/**
 * Loads the daemon's context breakdown while the sheet is open. It reloads when
 * the sheet opens, when the connection becomes ready again, when `refreshKey`
 * changes (a turn finished) and on `reload`. A failed load never keeps the
 * previous numbers, so stale values are not shown as current.
 */
export function useContextBreakdown(
  handle: SessionHandle | undefined,
  open: boolean,
  refreshKey: string,
) {
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const [state, setState] = useState<ContextState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !handle) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    handle.getContextBreakdown().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      () => {
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [handle, open, readyEpoch, refreshKey, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
