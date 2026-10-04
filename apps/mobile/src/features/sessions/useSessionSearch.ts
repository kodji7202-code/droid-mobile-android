import { useCallback, useEffect, useState } from 'react';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { toSearchRow } from './sessionsPaging';
import type { SessionRowData } from './sessionsPaging';

/** Typing pauses shorter than this never reach the daemon. */
export const SEARCH_DEBOUNCE_MS = 400;

export interface SessionSearchState {
  /** True when the trimmed query is non-empty. */
  active: boolean;
  /** True once `rows` belong to the current query (no request pending for it). */
  settled: boolean;
  rows: SessionRowData[];
  failed: boolean;
  rerun(): void;
}

interface Options {
  connection: DaemonConnection | null;
  ready: boolean;
  readyEpoch: number;
  query: string;
}

/**
 * Debounced sessions.search. Results are the daemon's own answer for the full
 * query; a response for an older query is discarded.
 */
export function useSessionSearch({
  connection,
  ready,
  readyEpoch,
  query,
}: Options): SessionSearchState {
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState(trimmed);
  const [result, setResult] = useState<{
    query: string;
    rows: SessionRowData[];
    failed: boolean;
  } | null>(null);
  const [rerunCount, setRerunCount] = useState(0);

  useEffect(() => {
    if (trimmed === '') {
      setDebounced('');
      setResult(null);
      return undefined;
    }
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  useEffect(() => {
    if (debounced === '' || !connection || !ready) {
      return undefined;
    }
    let cancelled = false;
    connection
      .searchSessions({ query: debounced })
      .then((found) => {
        if (!cancelled) {
          setResult({ query: debounced, rows: found.sessions.map(toSearchRow), failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ query: debounced, rows: [], failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, connection, ready, readyEpoch, rerunCount]);

  const rerun = useCallback(() => setRerunCount((count) => count + 1), []);

  const active = trimmed !== '';
  const settled = active && result !== null && result.query === trimmed;
  return {
    active,
    settled,
    rows: settled ? result.rows : [],
    failed: settled && result.failed,
    rerun,
  };
}
