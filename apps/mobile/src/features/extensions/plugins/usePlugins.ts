import { useCallback, useState } from 'react';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { redactError } from '../mcp/mcpStatus';
import { mergePlugins } from './pluginLogic';
import type { PluginEntry } from './pluginLogic';
import { errorText, useDaemonRead } from './useDaemonRead';

export type PluginAction = 'install' | 'uninstall' | 'toggle' | 'update';

export interface PluginActionError {
  action: PluginAction;
  name: string;
  /** The daemon's own text, secrets redacted; empty when it gave none. */
  message: string;
}

export interface PluginNotice {
  action: 'install' | 'uninstall' | 'update';
  name: string;
}

/** Scope every install uses: the user's own settings, so all projects get the plugin. */
export const INSTALL_SCOPE = 'user';

async function loadPlugins(connection: DaemonConnection): Promise<PluginEntry[]> {
  const [available, installed] = await Promise.all([
    connection.plugins.listAvailable(),
    connection.plugins.listInstalled(),
  ]);
  return mergePlugins(available, installed);
}

/**
 * Available plus installed plugins and their mutations. Every change is
 * followed by a re-read, so rows show what the daemon reports, never a guess.
 */
export function usePlugins(connection: DaemonConnection | null) {
  const { state, refresh, retry } = useDaemonRead(connection, loadPlugins);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<PluginActionError | null>(null);
  const [notice, setNotice] = useState<PluginNotice | null>(null);

  const track = useCallback(
    async (entry: PluginEntry, action: PluginAction, op: () => Promise<void>) => {
      if (!connection) return;
      setError(null);
      setNotice(null);
      setBusy((previous) => new Set(previous).add(entry.id));
      try {
        await op();
        if (action !== 'toggle') setNotice({ action, name: entry.name });
      } catch (failure) {
        setError({ action, name: entry.name, message: redactError(errorText(failure)) });
      } finally {
        setBusy((previous) => {
          const next = new Set(previous);
          next.delete(entry.id);
          return next;
        });
        await refresh();
      }
    },
    [connection, refresh],
  );

  const install = useCallback(
    (entry: PluginEntry) =>
      track(entry, 'install', async () => {
        await connection!.plugins.install({
          marketplace: entry.marketplace,
          name: entry.name,
          scope: INSTALL_SCOPE,
        });
      }),
    [connection, track],
  );

  const uninstall = useCallback(
    (entry: PluginEntry) =>
      track(entry, 'uninstall', () =>
        connection!.plugins.uninstall(entry.id, entry.installed?.scope ?? INSTALL_SCOPE),
      ),
    [connection, track],
  );

  const setEnabled = useCallback(
    (entry: PluginEntry, enabled: boolean) =>
      track(entry, 'toggle', () =>
        connection!.plugins.setEnabled(entry.id, entry.installed?.scope ?? INSTALL_SCOPE, enabled),
      ),
    [connection, track],
  );

  const update = useCallback(
    (entry: PluginEntry) =>
      track(entry, 'update', () =>
        connection!.plugins.updatePlugin(entry.id, entry.installed?.scope ?? INSTALL_SCOPE),
      ),
    [connection, track],
  );

  return {
    state,
    retry,
    busy,
    error,
    notice,
    dismissError: () => setError(null),
    dismissNotice: () => setNotice(null),
    install,
    uninstall,
    setEnabled,
    update,
  };
}
