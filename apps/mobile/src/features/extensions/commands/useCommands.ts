import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonConnection, SlashCommand } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../../stores/connection';

export type CommandsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; commands: SlashCommand[] };

/** The daemon's custom commands for the project folder (user level only when undefined). */
export function useCommands(connection: DaemonConnection | null, cwd: string | undefined) {
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const [state, setState] = useState<CommandsState>({ status: 'loading' });
  const latest = useRef(0);

  const read = useCallback(async () => {
    const ticket = ++latest.current;
    if (!connection) {
      setState({ status: 'error' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const commands = await connection.commands.list(cwd);
      if (ticket === latest.current) setState({ status: 'ready', commands });
    } catch {
      if (ticket === latest.current) setState({ status: 'error' });
    }
  }, [connection, cwd]);

  useEffect(() => {
    void read();
    return () => {
      latest.current += 1;
    };
  }, [read, readyEpoch]);

  return { state, retry: () => void read() };
}
