import { useEffect, useState } from 'react';
import type { DaemonConnection } from '@droidmobile/daemon-client';

export type DirectoryCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'invalid'; error: string }
  | { state: 'failed' }
  | { state: 'valid'; path: string; trustRoot: string; trustRequired: boolean };

export const DIRECTORY_CHECK_DEBOUNCE_MS = 300;

/**
 * Validates a working directory with the daemon (never locally: the daemon
 * owns the file system) and, for a valid one, asks whether it needs a trust
 * confirmation. Results of superseded inputs are discarded.
 */
export function useDirectoryCheck(
  connection: DaemonConnection | null,
  input: string,
  revision: number,
): DirectoryCheck {
  const [check, setCheck] = useState<DirectoryCheck>({ state: 'idle' });
  const trimmed = input.trim();

  useEffect(() => {
    if (trimmed === '') {
      setCheck({ state: 'idle' });
      return undefined;
    }
    if (!connection) {
      setCheck({ state: 'failed' });
      return undefined;
    }
    let cancelled = false;
    setCheck({ state: 'checking' });
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const validation = await connection.validateDirectory(trimmed);
          if (cancelled) return;
          if (!validation.isValid) {
            setCheck({ state: 'invalid', error: validation.error ?? '' });
            return;
          }
          const path = validation.resolvedPath ?? trimmed;
          const trust = await connection.checkFolderTrust(path);
          if (cancelled) return;
          setCheck({
            state: 'valid',
            path,
            trustRoot: trust.trustRootPath,
            trustRequired: trust.promptRequired,
          });
        } catch {
          if (!cancelled) setCheck({ state: 'failed' });
        }
      })();
    }, DIRECTORY_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection, trimmed, revision]);

  return check;
}
