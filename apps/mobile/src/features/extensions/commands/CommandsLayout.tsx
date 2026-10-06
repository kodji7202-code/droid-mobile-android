import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useConnectionStore } from '../../../stores/connection';

// Long enough for a StrictMode remount to cancel the release instead of opening a new session.
const RELEASE_DELAY_MS = 250;

let pendingRelease: ReturnType<typeof setTimeout> | null = null;

/** Keeps the commands scratch session alive while the section is open and closes it on leaving. */
export function CommandsLayout() {
  const connection = useConnectionStore((state) => state.connection);
  useEffect(() => {
    if (pendingRelease) {
      clearTimeout(pendingRelease);
      pendingRelease = null;
    }
    const commands = connection?.commands;
    if (!commands) return undefined;
    return () => {
      pendingRelease = setTimeout(() => {
        pendingRelease = null;
        void commands.release().catch(() => undefined);
      }, RELEASE_DELAY_MS);
    };
  }, [connection]);
  return <Outlet />;
}
