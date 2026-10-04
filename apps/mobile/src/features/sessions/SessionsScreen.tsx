import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SessionHandle } from '@droidmobile/daemon-client';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { NewSessionSheet } from './newSession/NewSessionSheet';
import { RenameSessionSheet } from './RenameSessionSheet';
import { SessionRow } from './SessionRow';
import type { SessionRowData } from './sessionsPaging';
import { usePullToRefresh } from './usePullToRefresh';
import { useSessionSearch } from './useSessionSearch';
import { useSessionsList } from './useSessionsList';

const SKELETON_ROWS = 5;

export function SessionsScreen() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const connection = useConnectionStore((state) => state.connection);
  const status = useConnectionStore((state) => state.status);
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const ready = status === 'ready';

  const [archivedView, setArchivedView] = useState(false);
  const list = useSessionsList({ connection, ready, readyEpoch, archived: archivedView });
  const { rows, loading, loadingMore, hasMore, failed, refresh, loadMore } = list;

  const [query, setQuery] = useState('');
  const search = useSessionSearch({ connection, ready, readyEpoch, query });
  const [manualRefresh, setManualRefresh] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<SessionRowData | null>(null);
  const navigate = useNavigate();
  const [renameBusy, setRenameBusy] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const runManualRefresh = useCallback(() => {
    setManualRefresh(true);
    void refresh().finally(() => setManualRefresh(false));
  }, [refresh]);
  const pull = usePullToRefresh(runManualRefresh);

  const searching = search.active;
  const visibleRows = searching ? search.rows : rows;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMore();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, rows.length]);

  const archive = async (row: SessionRowData) => {
    setMenuId(null);
    try {
      await connection?.archiveSession(row.id);
      list.removeLocally(row.id);
      void refresh();
      search.rerun();
    } catch {
      showToast(t('sessions.archiveFailed'), 'error');
    }
  };

  const unarchive = async (row: SessionRowData) => {
    setMenuId(null);
    try {
      await connection?.unarchiveSession(row.id);
      list.removeLocally(row.id);
      void refresh();
      search.rerun();
    } catch {
      showToast(t('sessions.unarchiveFailed'), 'error');
    }
  };

  const rename = async (title: string) => {
    if (!renaming) {
      return;
    }
    setRenameBusy(true);
    try {
      await connection?.renameSession(renaming.id, title);
      list.renameLocally(renaming.id, title);
      setRenaming(null);
      void refresh();
      search.rerun();
    } catch {
      showToast(t('sessions.renameFailed'), 'error');
    } finally {
      setRenameBusy(false);
    }
  };

  const onNewSession = () => setCreating(true);

  const onCreated = (handle: SessionHandle) => {
    useSessionViewStore.getState().adopt(handle, readyEpoch);
    setCreating(false);
    navigate(`/sessions/${handle.id}`);
  };

  const suggestions = useMemo(
    () =>
      [...new Set(rows.map((row) => row.cwd).filter((cwd): cwd is string => !!cwd))].slice(0, 4),
    [rows],
  );

  const transient =
    status === 'connecting' || status === 'authenticating' || status === 'reconnecting';
  const showSkeleton = !searching && loading && rows.length === 0 && (ready || transient);
  const showOfflineEmpty = !searching && !ready && !transient && rows.length === 0;
  const idle = !searching && !loading && ready && !failed && rows.length === 0;
  const firstRunEmpty = idle && !archivedView;
  const archivedEmpty = idle && archivedView;
  const loadFailed = !searching && !loading && ready && failed && rows.length === 0;
  const searchPending = searching && ready && !search.settled;
  const noResults = searching && search.settled && !search.failed && visibleRows.length === 0;

  return (
    <section
      className="screen sessions-screen"
      data-testid="sessions-screen"
      aria-labelledby="sessions-title"
      {...pull.handlers}
    >
      <div className="sessions-screen__header">
        <h2 className="screen__title" id="sessions-title">
          {t('nav.sessions')}
        </h2>
        <button
          type="button"
          className="btn btn--ghost"
          data-testid="sessions-refresh"
          onClick={runManualRefresh}
          disabled={!ready || manualRefresh}
        >
          {t('sessions.refresh')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          data-testid="session-new"
          onClick={onNewSession}
          disabled={!ready}
          title={ready ? undefined : t('sessions.newOffline')}
        >
          {t('sessions.new')}
        </button>
      </div>

      <input
        type="search"
        className="field__control"
        data-testid="session-search-input"
        aria-label={t('sessions.searchLabel')}
        placeholder={t('sessions.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="sessions-filter" role="group" aria-label={t('sessions.filterLabel')}>
        <button
          type="button"
          className={`btn ${archivedView ? 'btn--ghost' : 'btn--secondary'}`}
          data-testid="sessions-filter-active"
          aria-pressed={!archivedView}
          onClick={() => setArchivedView(false)}
        >
          {t('sessions.filterActive')}
        </button>
        <button
          type="button"
          className={`btn ${archivedView ? 'btn--secondary' : 'btn--ghost'}`}
          data-testid="sessions-filter-archived"
          aria-pressed={archivedView}
          onClick={() => setArchivedView(true)}
        >
          {t('sessions.filterArchived')}
        </button>
      </div>

      {!ready ? (
        <p
          className="sessions-notice sessions-notice--offline"
          role="status"
          data-testid="sessions-offline"
        >
          {t('sessions.offline')}
        </p>
      ) : null}
      {searchPending ? (
        <p className="sessions-notice" role="status" data-testid="sessions-searching">
          {t('sessions.searching')}
        </p>
      ) : null}
      {searching && search.settled && search.failed ? (
        <ErrorState
          title={t('sessions.loadFailedTitle')}
          message={t('sessions.searchFailed')}
          onRetry={search.rerun}
          retryLabel={t('common.retry')}
        />
      ) : null}
      {ready && failed && rows.length > 0 && !searching ? (
        <p className="sessions-notice" role="status" data-testid="sessions-stale">
          {t('sessions.stale')}
        </p>
      ) : null}
      {pull.distance > 0 || manualRefresh ? (
        <p
          className="sessions-notice sessions-refresh-indicator"
          role="status"
          data-testid="sessions-refreshing"
          style={{ minHeight: Math.max(pull.distance, 32) }}
        >
          {t('sessions.refreshing')}
        </p>
      ) : null}

      {showSkeleton || (searching ? visibleRows.length > 0 : rows.length > 0) ? (
        <ul
          className="session-list"
          data-testid="sessions-list"
          aria-busy={showSkeleton || list.refreshing}
        >
          {showSkeleton ? (
            <li className="session-list__loading" data-testid="sessions-loading">
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <Skeleton key={index} lines={2} />
              ))}
            </li>
          ) : (
            visibleRows.map((row) => (
              <SessionRow
                key={row.id}
                row={row}
                now={list.loadedAt}
                menuOpen={menuId === row.id}
                onOpen={(target) => navigate(`/sessions/${target.id}`)}
                onToggleMenu={(id) => setMenuId((current) => (current === id ? null : id))}
                onRename={(target) => {
                  setMenuId(null);
                  setRenaming(target);
                }}
                onArchive={(target) => void archive(target)}
                onUnarchive={(target) => void unarchive(target)}
              />
            ))
          )}
        </ul>
      ) : null}

      {noResults ? (
        <EmptyState
          title={t('sessions.noResultsTitle')}
          message={t('sessions.noResults', { query: query.trim() })}
        />
      ) : null}
      {archivedEmpty ? (
        <EmptyState
          title={t('sessions.archivedEmptyTitle')}
          message={t('sessions.archivedEmpty')}
        />
      ) : null}
      {firstRunEmpty ? (
        <EmptyState
          title={t('sessions.emptyTitle')}
          message={t('sessions.emptyMessage')}
          action={
            <button
              type="button"
              className="btn btn--primary"
              data-testid="session-new-empty"
              onClick={onNewSession}
            >
              {t('sessions.new')}
            </button>
          }
        />
      ) : null}
      {loadFailed ? (
        <ErrorState
          title={t('sessions.loadFailedTitle')}
          message={t('sessions.loadFailed')}
          onRetry={runManualRefresh}
          retryLabel={t('common.retry')}
        />
      ) : null}
      {showOfflineEmpty ? (
        <EmptyState title={t('sessions.offlineEmptyTitle')} message={t('sessions.offlineEmpty')} />
      ) : null}

      {hasMore && !searching ? (
        <div ref={sentinelRef} className="session-list__more">
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="sessions-load-more"
            onClick={() => void loadMore()}
            disabled={loadingMore || !ready}
          >
            {loadingMore ? t('sessions.loadingMore') : t('sessions.loadMore')}
          </button>
        </div>
      ) : null}

      {creating ? (
        <NewSessionSheet
          connection={connection}
          suggestions={suggestions}
          onCreated={onCreated}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {renaming ? (
        <RenameSessionSheet
          initialTitle={renaming.title}
          busy={renameBusy}
          onSubmit={(title) => void rename(title)}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </section>
  );
}
