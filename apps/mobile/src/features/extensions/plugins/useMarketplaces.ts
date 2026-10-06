import { useCallback, useState } from 'react';
import type { DaemonConnection, Marketplace } from '@droidmobile/daemon-client';
import { redactError } from '../mcp/mcpStatus';
import { errorText, useDaemonRead } from './useDaemonRead';

export type MarketplaceAction = 'add' | 'remove' | 'update';

export interface MarketplaceActionError {
  action: MarketplaceAction;
  name: string;
  /** The daemon's own text, secrets redacted; empty when it gave none. */
  message: string;
}

export interface MarketplaceNotice {
  action: MarketplaceAction;
  name: string;
}

const failure = (
  action: MarketplaceAction,
  name: string,
  cause: unknown,
): MarketplaceActionError => ({ action, name, message: redactError(errorText(cause)) });

const loadMarketplaces = (connection: DaemonConnection): Promise<Marketplace[]> =>
  connection.plugins.listMarketplaces();

/**
 * Marketplace list plus add, remove and update. Every change is followed by a
 * re-read; a refusal keeps the daemon's text so the screen can show it.
 */
export function useMarketplaces(connection: DaemonConnection | null) {
  const { state, refresh, retry } = useDaemonRead(connection, loadMarketplaces);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<MarketplaceActionError | null>(null);
  const [notice, setNotice] = useState<MarketplaceNotice | null>(null);

  const add = useCallback(
    async (repo: string) => {
      if (!connection) return false;
      setError(null);
      setNotice(null);
      setAdding(true);
      try {
        const name = await connection.plugins.addMarketplace(repo);
        setNotice({ action: 'add', name });
        return true;
      } catch (cause) {
        setError(failure('add', repo, cause));
        return false;
      } finally {
        setAdding(false);
        await refresh();
      }
    },
    [connection, refresh],
  );

  const track = useCallback(
    async (name: string, action: 'remove' | 'update', op: () => Promise<void>) => {
      if (!connection) return;
      setError(null);
      setNotice(null);
      setBusy((previous) => new Set(previous).add(name));
      try {
        await op();
        setNotice({ action, name });
      } catch (cause) {
        setError(failure(action, name, cause));
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

  const remove = useCallback(
    (name: string) => track(name, 'remove', () => connection!.plugins.removeMarketplace(name)),
    [connection, track],
  );

  const update = useCallback(
    (name: string) => track(name, 'update', () => connection!.plugins.updateMarketplace(name)),
    [connection, track],
  );

  return {
    state,
    retry,
    busy,
    adding,
    error,
    notice,
    dismissError: () => setError(null),
    dismissNotice: () => setNotice(null),
    add,
    remove,
    update,
  };
}
