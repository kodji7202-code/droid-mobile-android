import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionError } from '@droidmobile/daemon-client';
import type { AddMcpServerInput, DaemonConnection } from '@droidmobile/daemon-client';
import { useMcpServerList } from './useMcpServerList';

const IDLE_POLL_MS = 3000;
const AUTH_POLL_MS = 1000;

export type McpAction = 'add' | 'toggle' | 'remove' | 'auth' | 'cancelAuth';
export interface McpActionError {
  action: McpAction;
  name: string;
}

/**
 * MCP list plus its mutations. Every change is followed by a re-read, so what
 * the rows show is what the daemon reports, never an optimistic guess.
 */
export function useMcp(connection: DaemonConnection | null) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [authPending, setAuthPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<McpActionError | null>(null);
  const cancelled = useRef(new Set<string>());
  /** Sign-ins whose call was cut by a dropped socket but that the daemon may still hold. */
  const detached = useRef(new Set<string>());
  /** Sign-ins whose authorization page was already opened, so a remount never reopens it. */
  const opened = useRef(new Set<string>());
  const authRef = useRef(authPending);
  authRef.current = authPending;

  const list = useMcpServerList(connection, authPending.size > 0 ? AUTH_POLL_MS : IDLE_POLL_MS);
  const { refresh } = list;

  const track = useCallback(
    async (
      name: string,
      action: McpAction,
      op: (mcp: DaemonConnection['mcp']) => Promise<void>,
    ) => {
      if (!connection) return false;
      setError(null);
      setBusy((previous) => new Set(previous).add(name));
      try {
        await op(connection.mcp);
        return true;
      } catch {
        setError({ action, name });
        return false;
      } finally {
        setBusy((previous) => {
          const next = new Set(previous);
          next.delete(name);
          return next;
        });
        await refresh();
      }
    },
    [connection, refresh],
  );

  const add = useCallback(
    async (input: AddMcpServerInput) => {
      if (!connection) return false;
      setError(null);
      setAdding(true);
      try {
        await connection.mcp.addServer(input);
        return true;
      } catch {
        setError({ action: 'add', name: input.name });
        return false;
      } finally {
        setAdding(false);
        await refresh();
      }
    },
    [connection, refresh],
  );

  const toggle = useCallback(
    (name: string, enabled: boolean) =>
      track(name, 'toggle', (mcp) => mcp.toggleServer(name, enabled)),
    [track],
  );

  const remove = useCallback(
    (name: string, hasAuth: boolean) =>
      track(name, 'remove', async (mcp) => {
        // Drop the stored sign-in too so a re-added server starts clean.
        if (hasAuth) await mcp.clearAuth(name).catch(() => undefined);
        await mcp.removeServer(name);
      }),
    [track],
  );

  const endAuth = useCallback((name: string) => {
    cancelled.current.delete(name);
    detached.current.delete(name);
    opened.current.delete(name);
    setAuthPending((previous) => {
      const next = new Set(previous);
      next.delete(name);
      return next;
    });
  }, []);

  const startAuth = useCallback(
    (name: string) => {
      if (!connection || authRef.current.has(name)) return;
      setError(null);
      opened.current.delete(name);
      setAuthPending((previous) => new Set(previous).add(name));
      // The call settles only when the sign-in ends (success, failure or cancel).
      void (async () => {
        try {
          await connection.mcp.authenticateServer(name);
        } catch (err) {
          if (!cancelled.current.has(name)) {
            if (err instanceof ConnectionError) {
              // A dropped socket (the app was in the background) ends the call, not the
              // sign-in: the daemon keeps it and the list reports it again once reconnected.
              detached.current.add(name);
              void refresh();
              return;
            }
            setError({ action: 'auth', name });
          }
        }
        endAuth(name);
        void refresh();
      })();
    },
    [connection, refresh, endAuth],
  );

  const cancelAuth = useCallback(
    async (name: string) => {
      if (!connection) return;
      // A live sign-in's pending call rejects after the cancel and endAuth() then clears
      // the marker; a detached one has no such call.
      if (detached.current.has(name)) endAuth(name);
      else {
        cancelled.current.add(name);
        setAuthPending((previous) => {
          const next = new Set(previous);
          next.delete(name);
          return next;
        });
      }
      try {
        await connection.mcp.cancelAuth(name);
      } catch {
        setError({ action: 'cancelAuth', name });
      }
      await refresh();
    },
    [connection, refresh, endAuth],
  );

  useEffect(() => {
    if (list.state.status !== 'ready' || detached.current.size === 0) return;
    const { servers } = list.state;
    for (const name of [...detached.current]) {
      if (!servers.find((server) => server.name === name)?.pendingAuthUrl) endAuth(name);
    }
  }, [list.state, endAuth]);

  const isAuthOpened = useCallback((name: string) => opened.current.has(name), []);
  const markAuthOpened = useCallback((name: string) => void opened.current.add(name), []);

  useEffect(
    () => () => {
      for (const name of authRef.current)
        void connection?.mcp.cancelAuth(name).catch(() => undefined);
    },
    [connection],
  );

  return {
    ...list,
    busy,
    adding,
    authPending,
    error,
    clearError: () => setError(null),
    add,
    toggle,
    remove,
    startAuth,
    cancelAuth,
    isAuthOpened,
    markAuthOpened,
  };
}
