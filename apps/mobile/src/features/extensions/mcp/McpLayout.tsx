import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useConnectionStore } from '../../../stores/connection';

// Long enough for an unmount cleanup in a child (a last cancelAuth) to be
// sent before the session it needs is closed.
const RELEASE_DELAY_MS = 250;

let pendingRelease: ReturnType<typeof setTimeout> | null = null;

/**
 * Wraps the MCP list and detail routes so they share the client's scratch
 * session, and closes it once the user leaves the section. A remount right
 * after an unmount (StrictMode) cancels the release instead of reconnecting
 * every server in a fresh session.
 */
export function McpLayout() {
  const connection = useConnectionStore((state) => state.connection);
  useEffect(() => {
    if (pendingRelease) {
      clearTimeout(pendingRelease);
      pendingRelease = null;
    }
    const mcp = connection?.mcp;
    if (!mcp) return undefined;
    return () => {
      pendingRelease = setTimeout(() => {
        pendingRelease = null;
        void mcp.release().catch(() => undefined);
      }, RELEASE_DELAY_MS);
    };
  }, [connection]);
  return <Outlet />;
}
