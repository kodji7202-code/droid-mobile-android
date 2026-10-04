import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { mergeRows, nextEndBefore, PAGE_SIZE, toRow } from './sessionsPaging';
import type { SessionRowData } from './sessionsPaging';

/** Polling cadence while the list is visible (contract: changes appear within 15 s). */
export const POLL_INTERVAL_MS = 10_000;
const MAX_REFRESH_PAGES = 40;

interface LoadedPages {
  rows: SessionRowData[];
  hasMore: boolean;
  endBefore: number | undefined;
}

/**
 * Loads at least `minPages` pages. With `coverMs` it keeps going until the
 * oldest loaded row is as old as `coverMs`, then drops anything older, so a
 * refresh keeps the extent the user already scrolled to (an archived row
 * shrinks the list by one instead of being backfilled from the next page).
 */
async function loadPages(
  connection: DaemonConnection,
  start: Pick<LoadedPages, 'rows' | 'endBefore'>,
  options: { minPages: number; coverMs?: number; archived: boolean },
): Promise<LoadedPages> {
  let rows = start.rows;
  let endBefore = start.endBefore;
  let hasMore = true;
  // The daemon has no archived-only list: archived rows are picked out of
  // includeArchived pages, so keep reading until a page's worth turned up.
  const wanted = start.rows.length + (options.archived ? PAGE_SIZE : 0);
  for (let index = 0; index < MAX_REFRESH_PAGES && hasMore; index += 1) {
    const covered =
      index >= options.minPages &&
      rows.length >= wanted &&
      (options.coverMs === undefined || oldestMs(rows) <= options.coverMs);
    if (covered) {
      break;
    }
    const page = await connection.listSessions({
      limit: PAGE_SIZE,
      ...(options.archived ? { includeArchived: true } : {}),
      ...(endBefore !== undefined ? { endBefore } : {}),
    });
    const pageRows = page.map(toRow);
    rows = mergeRows(rows, options.archived ? pageRows.filter((row) => row.archived) : pageRows);
    hasMore = page.length >= PAGE_SIZE;
    endBefore = nextEndBefore(pageRows, endBefore);
  }
  if (options.coverMs === undefined) {
    return { rows, hasMore: hasMore && endBefore !== undefined, endBefore };
  }
  const { coverMs } = options;
  const kept = rows.filter((row) => row.modifiedMs >= coverMs);
  if (kept.length === rows.length) {
    return { rows, hasMore: hasMore && endBefore !== undefined, endBefore };
  }
  return { rows: kept, hasMore: true, endBefore: nextEndBefore(kept, undefined) };
}

function oldestMs(rows: SessionRowData[]): number {
  return rows.length === 0 ? Infinity : Math.min(...rows.map((row) => row.modifiedMs));
}
export interface SessionsListState {
  rows: SessionRowData[];
  /** True until the first page settled (success or failure). */
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Set when the last load failed; rows already loaded stay available. */
  failed: boolean;
  /** Time of the last successful load, used for relative "modified" labels. */
  loadedAt: number;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  removeLocally(id: string): void;
  renameLocally(id: string, title: string): void;
}

interface Options {
  connection: DaemonConnection | null;
  /** Lists archived sessions only instead of the default (non-archived) list. */
  archived?: boolean;
  ready: boolean;
  readyEpoch: number;
}

/**
 * Cursor-paged sessions.list. Refreshes re-read every page loaded so far so a
 * rename or archive done elsewhere shows up wherever it sits in the list. It
 * runs on mount, on every readyEpoch change (reconnects), on focus/visibility
 * and on a 10 s poll while the page is visible. Nothing is requested while the
 * connection is not ready, so the loaded rows simply stay on screen.
 */
export function useSessionsList({
  connection,
  ready,
  readyEpoch,
  archived = false,
}: Options): SessionsListState {
  const [rows, setRows] = useState<SessionRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  const rowsRef = useRef<SessionRowData[]>([]);
  const cursorRef = useRef<number | undefined>(undefined);
  const busyRef = useRef(false);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const archivedRef = useRef(archived);
  archivedRef.current = archived;
  // Bumped when the filter changes so an in-flight load for the old filter is dropped.
  const generationRef = useRef(0);

  const apply = useCallback((loaded: LoadedPages) => {
    rowsRef.current = loaded.rows;
    cursorRef.current = loaded.endBefore;
    setRows(loaded.rows);
    setHasMore(loaded.hasMore);
    setFailed(false);
    setLoadedAt(Date.now());
  }, []);

  const refresh = useCallback(async () => {
    const active = connectionRef.current;
    if (!active || busyRef.current) {
      return;
    }
    busyRef.current = true;
    const generation = generationRef.current;
    setRefreshing(true);
    try {
      const loaded = rowsRef.current;
      const next = await loadPages(
        active,
        { rows: [], endBefore: undefined },
        {
          minPages: 1,
          coverMs: loaded.length > 0 ? oldestMs(loaded) : undefined,
          archived: archivedRef.current,
        },
      );
      if (generation === generationRef.current) {
        apply(next);
      }
    } catch {
      if (generation === generationRef.current) {
        setFailed(true);
      }
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [apply]);

  const loadMore = useCallback(async () => {
    const active = connectionRef.current;
    if (!active || busyRef.current || cursorRef.current === undefined) {
      return;
    }
    busyRef.current = true;
    const generation = generationRef.current;
    setLoadingMore(true);
    try {
      const next = await loadPages(
        active,
        { rows: rowsRef.current, endBefore: cursorRef.current },
        { minPages: 1, archived: archivedRef.current },
      );
      if (generation === generationRef.current) {
        apply(next);
      }
    } catch {
      if (generation === generationRef.current) {
        setFailed(true);
      }
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [apply]);

  const previousArchived = useRef(archived);
  useEffect(() => {
    if (previousArchived.current === archived) {
      return;
    }
    previousArchived.current = archived;
    generationRef.current += 1;
    busyRef.current = false;
    rowsRef.current = [];
    cursorRef.current = undefined;
    setRows([]);
    setHasMore(false);
    setFailed(false);
    setRefreshing(false);
    setLoadingMore(false);
    setLoading(true);
    if (ready) {
      void refresh();
    }
  }, [archived, ready, refresh]);

  useEffect(() => {
    if (ready) {
      void refresh();
    }
  }, [ready, readyEpoch, connection, refresh]);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const tick = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [ready, refresh]);

  const removeLocally = useCallback((id: string) => {
    rowsRef.current = rowsRef.current.filter((row) => row.id !== id);
    setRows(rowsRef.current);
  }, []);

  const renameLocally = useCallback((id: string, title: string) => {
    rowsRef.current = rowsRef.current.map((row) => (row.id === id ? { ...row, title } : row));
    setRows(rowsRef.current);
  }, []);

  return {
    rows,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    failed,
    loadedAt,
    refresh,
    loadMore,
    removeLocally,
    renameLocally,
  };
}
