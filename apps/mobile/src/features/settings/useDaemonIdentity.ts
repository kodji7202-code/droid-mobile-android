import { useEffect, useState } from 'react';
import type { DaemonIdentity } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';

/**
 * Reads the daemon identity (protocol and daemon version) on demand while the
 * connection is ready. The probe is a short-lived second socket, so it runs
 * only on screens that show it and never as part of connecting.
 */
export function useDaemonIdentity(): DaemonIdentity | null {
  const connection = useConnectionStore((state) => state.connection);
  const status = useConnectionStore((state) => state.status);
  const [identity, setIdentity] = useState<DaemonIdentity | null>(null);

  useEffect(() => {
    if (!connection || status !== 'ready') {
      setIdentity(null);
      return;
    }
    let cancelled = false;
    connection
      .getDaemonIdentity()
      .then((value) => {
        if (!cancelled) setIdentity(value);
      })
      .catch(() => {
        if (!cancelled) setIdentity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, status]);

  return identity;
}
