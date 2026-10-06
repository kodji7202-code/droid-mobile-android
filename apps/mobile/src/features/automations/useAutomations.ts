import { useCallback, useEffect, useRef, useState } from 'react';
import type { Automation, DaemonConnection } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';
import { useLinkLoss } from '../extensions/useLinkLoss';

export type AutomationsStatus = 'loading' | 'ready' | 'error';

export interface AutomationActionError {
  action: 'pause' | 'resume';
  id: string;
  /** The daemon's own wording for a refusal, when it gave one. */
  detail: string;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message.trim() : '');

/**
 * The daemon's automations plus pause/resume. Rows always show what the daemon
 * last reported: a change is followed by a re-read and never applied
 * optimistically. After the link drops the previous rows stay as stale data
 * under an error status, with every control disabled by `canAct`.
 */
export function useAutomations(connection: DaemonConnection | null) {
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const linkReady = useConnectionStore((state) => state.status === 'ready');
  const [status, setStatus] = useState<AutomationsStatus>('loading');
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<AutomationActionError | null>(null);
  const latest = useRef(0);

  const read = useCallback(
    async (showLoading: boolean) => {
      const ticket = ++latest.current;
      if (!connection) {
        setStatus('error');
        return;
      }
      if (showLoading) setStatus('loading');
      try {
        const list = await connection.automations.list();
        if (ticket !== latest.current) return;
        setAutomations(list);
        setStatus('ready');
      } catch {
        if (ticket === latest.current) setStatus('error');
      }
    },
    [connection],
  );

  useLinkLoss(() => {
    latest.current += 1;
    setStatus('error');
  });

  useEffect(() => {
    void read(true);
    return () => {
      latest.current += 1;
    };
  }, [read, readyEpoch]);

  const change = useCallback(
    async (action: AutomationActionError['action'], id: string) => {
      if (!connection) return;
      setError(null);
      setBusy((current) => new Set(current).add(id));
      try {
        await connection.automations[action](id);
        await read(false);
      } catch (cause) {
        setError({ action, id, detail: messageOf(cause) });
      } finally {
        setBusy((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [connection, read],
  );

  return {
    status,
    automations,
    busy,
    error,
    /** Controls work only while the daemon link is up and the list is current. */
    canAct: linkReady && status === 'ready',
    pause: useCallback((id: string) => change('pause', id), [change]),
    resume: useCallback((id: string) => change('resume', id), [change]),
    retry: useCallback(() => void read(true), [read]),
    clearError: useCallback(() => setError(null), []),
  };
}
