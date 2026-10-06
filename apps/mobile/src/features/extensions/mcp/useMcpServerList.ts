import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonConnection, McpServer } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../../stores/connection';
import { useLinkLoss } from '../useLinkLoss';

export type McpListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; servers: McpServer[] };

/**
 * The daemon's MCP server list, re-read on an interval so status changes
 * (connect results, an OAuth requirement) show up without a manual refresh.
 * Nothing is cached outside React state.
 */
export function useMcpServerList(connection: DaemonConnection | null, intervalMs: number) {
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const [state, setState] = useState<McpListState>({ status: 'loading' });
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
        const servers = await connection.mcp.listServers();
        if (ticket === latest.current) setState({ status: 'ready', servers });
      } catch {
        // A failed background poll keeps the last good list on screen.
        if (ticket === latest.current && showLoading) setState({ status: 'error' });
      }
    },
    [connection],
  );

  useLinkLoss(() => {
    latest.current += 1;
    setState({ status: 'error' });
  });

  useEffect(() => {
    void read(true);
    return () => {
      latest.current += 1;
    };
  }, [read, readyEpoch]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void read(false);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [read, intervalMs]);

  return {
    state,
    refresh: useCallback(() => read(false), [read]),
    retry: useCallback(() => void read(true), [read]),
  };
}
