import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonConnection, DefaultSettings, DefaultsPatch } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';

export type DefaultsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; defaults: DefaultSettings };

export type DefaultsField = keyof DefaultsPatch;

/**
 * Reads the daemon-wide defaults and writes changes back. A change shows in
 * `defaults` only once the daemon holds it (the value is re-read after every
 * write), so a rejected save leaves the previous value selected.
 */
export function useDaemonDefaults(connection: DaemonConnection | null) {
  const ready = useConnectionStore((state) => state.status === 'ready');
  const [state, setState] = useState<DefaultsState>({ status: 'loading' });
  const [pending, setPending] = useState<DefaultsPatch>({});
  const [failed, setFailed] = useState(false);
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
        const defaults = await connection.getDefaultSettings();
        if (ticket === latest.current) setState({ status: 'ready', defaults });
      } catch {
        if (ticket === latest.current && showLoading) setState({ status: 'error' });
      }
    },
    [connection],
  );

  useEffect(() => {
    void read(true);
    return () => {
      latest.current += 1;
    };
    // Re-read when the link comes back so an error state recovers by itself.
  }, [read, ready]);

  const apply = useCallback(
    async (patch: DefaultsPatch) => {
      if (!connection) return;
      setFailed(false);
      setPending((previous) => ({ ...previous, ...patch }));
      try {
        await connection.updateDefaultSettings(patch);
      } catch {
        setFailed(true);
      } finally {
        setPending((previous) => {
          const rest = { ...previous };
          for (const key of Object.keys(patch) as DefaultsField[]) delete rest[key];
          return rest;
        });
        await read(false);
      }
    },
    [connection, read],
  );

  return { state, pending, failed, apply, retry: () => void read(true) };
}
