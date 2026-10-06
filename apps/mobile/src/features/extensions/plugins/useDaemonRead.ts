import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../../stores/connection';

export type ReadState<T> =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/**
 * Reads a value from the daemon on mount and whenever the link comes back,
 * never caching it outside React state. `load` must be a stable function.
 * refresh() re-reads silently so mutations show what the daemon now reports.
 */
export function useDaemonRead<T>(
  connection: DaemonConnection | null,
  load: (connection: DaemonConnection) => Promise<T>,
) {
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const [state, setState] = useState<ReadState<T>>({ status: 'loading' });
  const latest = useRef(0);

  const read = useCallback(
    async (showLoading: boolean) => {
      const ticket = ++latest.current;
      if (!connection) {
        setState({ status: 'error' });
        return;
      }
      if (showLoading) setState({ status: 'loading' });
      try {
        const data = await load(connection);
        if (ticket === latest.current) setState({ status: 'ready', data });
      } catch {
        if (ticket === latest.current && showLoading) setState({ status: 'error' });
      }
    },
    [connection, load],
  );

  useEffect(() => {
    void read(true);
    return () => {
      latest.current += 1;
    };
  }, [read, readyEpoch]);

  return {
    state,
    refresh: useCallback(() => read(false), [read]),
    retry: useCallback(() => void read(true), [read]),
  };
}

/** The daemon's own wording for a refusal, or '' when the failure carries none. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.trim() : '';
}
