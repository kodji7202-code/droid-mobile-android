import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EyeIcon, EyeOffIcon, FolderIcon } from '../../components/icons';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { useWorkspaceStore } from '../../stores/workspace';
import { ChangeDirectorySheet } from './ChangeDirectorySheet';
import { FileSearch } from './FileSearch';
import { FileViewer } from './FileViewer';
import { FilesTree } from './FilesTree';
import { GitChangesList } from './GitChangesList';
import { GitDiffViewer } from './GitDiffViewer';
import { splitUnifiedDiffByFile } from './diffParser';
import { buildTree, flattenTree } from './treeBuilder';
import type {
  DaemonGetGitDiffResult,
  DaemonResolvePullRequestStatusesRequestParams,
} from '@droidmobile/daemon-client';
import type { PullRequestStatusInfo } from './PullRequestChip';

const EMPTY_EXPANDED: string[] = [];
const EMPTY_FILES: string[] = [];

export function WorkspaceScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const connection = useConnectionStore((s) => s.connection);
  const readyEpoch = useConnectionStore((s) => s.readyEpoch);

  const activeSessionId = useSessionViewStore((s) => s.activeSessionId);
  const activeView = useSessionViewStore((s) =>
    activeSessionId ? s.views[activeSessionId] : undefined,
  );
  const openSession = useSessionViewStore((s) => s.open);
  const updateCwd = useSessionViewStore((s) => s.updateCwd);

  const showHidden = useWorkspaceStore((s) => s.showHidden);
  const toggleHidden = useWorkspaceStore((s) => s.toggleHidden);
  const searchQuery = useWorkspaceStore((s) => s.searchQuery);
  const setSearchQuery = useWorkspaceStore((s) => s.setSearchQuery);

  const expandedList = useWorkspaceStore((s) =>
    activeSessionId ? (s.expandedBySession[activeSessionId] ?? EMPTY_EXPANDED) : EMPTY_EXPANDED,
  );
  const expandedPaths = useMemo(() => new Set(expandedList), [expandedList]);
  const toggleExpanded = useWorkspaceStore((s) => s.toggleExpanded);
  const scrollTop = useWorkspaceStore((s) =>
    activeSessionId ? (s.scrollBySession[activeSessionId] ?? 0) : 0,
  );
  const setScrollTop = useWorkspaceStore((s) => s.setScrollTop);

  const [rawFiles, setRawFiles] = useState<string[]>(EMPTY_FILES);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changeDirOpen, setChangeDirOpen] = useState(false);

  // Git changes state
  const [gitDiffData, setGitDiffData] = useState<DaemonGetGitDiffResult | null>(null);
  const [loadingGit, setLoadingGit] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [prStatus, setPrStatus] = useState<PullRequestStatusInfo | null | undefined>(undefined);

  const fetchSeq = useRef(0);
  const gitFetchSeq = useRef(0);

  const activeTab = searchParams.get('tab') === 'changes' ? 'changes' : 'files';
  const viewingFile = searchParams.get('file');
  const viewingDiffFile = searchParams.get('diff');

  // Open the active session if not opened yet
  useEffect(() => {
    if (connection && activeSessionId && !activeView) {
      void openSession(connection, activeSessionId, readyEpoch);
    }
  }, [connection, activeSessionId, activeView, openSession, readyEpoch]);

  const cwd = activeView?.cwd ?? activeView?.handle?.cwd ?? '';

  // Load files when session, cwd, or showHidden changes
  const loadFiles = useCallback(
    async (targetSessionId: string, targetShowHidden: boolean) => {
      if (!connection) return;
      const seq = ++fetchSeq.current;
      setLoadingFiles(true);
      setLoadError(null);

      try {
        const files = await connection.listFiles(targetSessionId, targetShowHidden);
        if (seq === fetchSeq.current) {
          setRawFiles(files);
          setLoadingFiles(false);
        }
      } catch (err) {
        if (seq === fetchSeq.current) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoadingFiles(false);
        }
      }
    },
    [connection],
  );

  useEffect(() => {
    if (!activeSessionId) {
      setRawFiles(EMPTY_FILES);
      return;
    }
    void loadFiles(activeSessionId, showHidden);
  }, [activeSessionId, cwd, showHidden, loadFiles]);

  // Load Git diff and PR status
  const loadGitDiff = useCallback(
    async (targetSessionId: string) => {
      if (!connection || typeof connection.getGitDiff !== 'function') return;
      const seq = ++gitFetchSeq.current;
      setLoadingGit(true);
      setGitError(null);

      try {
        const result = await connection.getGitDiff({ sessionId: targetSessionId });
        if (seq !== gitFetchSeq.current) return;
        setGitDiffData(result);
        setLoadingGit(false);

        // If not a git repo or no branch, no PR status
        if (!result.success || !result.data.branch) {
          setPrStatus(null);
          return;
        }

        // Fetch PR status if connection supports it
        if (typeof connection.resolvePullRequestStatuses === 'function') {
          try {
            const prRes = await connection.resolvePullRequestStatuses({
              lookups: [
                {
                  subject: {
                    kind: 'branch' as DaemonResolvePullRequestStatusesRequestParams['lookups'][number]['subject']['kind'],
                    sessionId: targetSessionId,
                  },
                },
              ],
            });
            if (seq === gitFetchSeq.current) {
              setPrStatus(prRes.statuses?.[0]?.status ?? null);
            }
          } catch {
            if (seq === gitFetchSeq.current) {
              setPrStatus(null);
            }
          }
        }
      } catch (err) {
        if (seq === gitFetchSeq.current) {
          setGitError(err instanceof Error ? err.message : String(err));
          setLoadingGit(false);
        }
      }
    },
    [connection],
  );

  useEffect(() => {
    if (!activeSessionId) {
      setGitDiffData(null);
      setPrStatus(undefined);
      return;
    }
    if (activeTab === 'changes' || viewingDiffFile) {
      void loadGitDiff(activeSessionId);
    }
  }, [activeSessionId, cwd, activeTab, viewingDiffFile, loadGitDiff]);

  const tree = useMemo(() => buildTree(rawFiles), [rawFiles]);
  const flattenedItems = useMemo(() => flattenTree(tree, expandedPaths), [tree, expandedPaths]);

  const handleToggleFolder = useCallback(
    (folderPath: string) => {
      if (!activeSessionId) return;
      toggleExpanded(activeSessionId, folderPath);
    },
    [activeSessionId, toggleExpanded],
  );

  const handleScroll = useCallback(
    (newScrollTop: number) => {
      if (!activeSessionId) return;
      setScrollTop(activeSessionId, newScrollTop);
    },
    [activeSessionId, setScrollTop],
  );

  const handleOpenFile = useCallback(
    (filePath: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('file', filePath);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const handleBackFromViewer = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('file');
      return next;
    });
  }, [setSearchParams]);

  const handleSelectTab = useCallback(
    (tab: 'files' | 'changes') => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'files') {
            next.delete('tab');
          } else {
            next.set('tab', tab);
          }
          next.delete('file');
          next.delete('diff');
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const handleOpenDiffFile = useCallback(
    (filePath: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('diff', filePath);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const handleBackFromDiffViewer = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('diff');
      return next;
    });
  }, [setSearchParams]);

  // Guided empty state if no active session
  if (!activeSessionId) {
    return (
      <section className="screen workspace-screen" data-testid="workspace-screen">
        <div
          className="workspace-empty"
          data-testid="workspace-empty"
          style={{ padding: '32px 16px', textAlign: 'center' }}
        >
          <h2
            className="workspace-empty__title"
            style={{ fontSize: '1.25rem', marginBottom: '8px' }}
          >
            {t('workspace.emptyTitle')}
          </h2>
          <p
            className="workspace-empty__description"
            style={{ opacity: 0.7, marginBottom: '24px' }}
          >
            {t('workspace.emptyDescription')}
          </p>
          <div
            className="workspace-empty__actions"
            style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}
          >
            <button
              type="button"
              className="btn btn--primary"
              data-testid="workspace-pick-session"
              onClick={() => navigate('/sessions')}
            >
              {t('workspace.pickSession')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="workspace-start-session"
              onClick={() => navigate('/sessions')}
            >
              {t('workspace.startSession')}
            </button>
          </div>
        </div>
      </section>
    );
  }

  // File Viewer view
  if (viewingFile) {
    return (
      <section
        className="screen workspace-screen"
        data-testid="workspace-screen"
        style={{ height: '100%', padding: 0 }}
      >
        <FileViewer
          sessionId={activeSessionId}
          filePath={viewingFile}
          onBack={handleBackFromViewer}
        />
      </section>
    );
  }

  // Diff Viewer view
  if (viewingDiffFile) {
    const diffText = gitDiffData?.success ? gitDiffData.data.diff : '';
    const fileDiffMap = splitUnifiedDiffByFile(diffText);
    const rawDiff = fileDiffMap.get(viewingDiffFile) ?? '';
    const fileEntry = gitDiffData?.success
      ? gitDiffData.data.files.find((f) => f.path === viewingDiffFile)
      : undefined;
    return (
      <section
        className="screen workspace-screen"
        data-testid="workspace-screen"
        style={{ height: '100%', padding: 0 }}
      >
        <GitDiffViewer
          filePath={viewingDiffFile}
          rawDiff={rawDiff}
          additions={fileEntry?.additions}
          deletions={fileEntry?.deletions}
          onBack={handleBackFromDiffViewer}
        />
      </section>
    );
  }

  return (
    <section
      className="screen workspace-screen"
      data-testid="workspace-screen"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
    >
      {/* Workspace Header */}
      <header
        className="workspace-header"
        data-testid="workspace-header"
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border, #eee)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="workspace-header__cwd"
              data-testid="workspace-cwd"
              style={{
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontWeight: 600,
              }}
              title={cwd}
            >
              {cwd || t('workspace.loading')}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              data-testid="workspace-change-directory"
              onClick={() => setChangeDirOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <FolderIcon width={16} height={16} />
              <span>{t('workspace.changeDirectory')}</span>
            </button>

            {activeTab === 'files' && (
              <button
                type="button"
                className={`btn btn--icon btn--sm ${showHidden ? 'btn--active' : ''}`}
                data-testid="workspace-toggle-hidden"
                aria-label={showHidden ? t('workspace.hideHidden') : t('workspace.showHidden')}
                title={showHidden ? t('workspace.hideHidden') : t('workspace.showHidden')}
                onClick={toggleHidden}
              >
                {showHidden ? (
                  <EyeOffIcon width={18} height={18} />
                ) : (
                  <EyeIcon width={18} height={18} />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Tab switcher: Files / Changes */}
        <div
          className="workspace-tabs"
          data-testid="workspace-tabs"
          role="tablist"
          style={{
            display: 'flex',
            backgroundColor: 'var(--color-surface-variant, #f0f0f2)',
            borderRadius: '6px',
            padding: '2px',
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'files'}
            className={`btn btn--sm ${activeTab === 'files' ? 'btn--primary' : 'btn--ghost'}`}
            data-testid="workspace-tab-files"
            onClick={() => handleSelectTab('files')}
            style={{ flex: 1, borderRadius: '4px', fontSize: '0.85rem', padding: '6px 12px' }}
          >
            {t('workspace.tabs.files')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'changes'}
            className={`btn btn--sm ${activeTab === 'changes' ? 'btn--primary' : 'btn--ghost'}`}
            data-testid="workspace-tab-changes"
            onClick={() => handleSelectTab('changes')}
            style={{ flex: 1, borderRadius: '4px', fontSize: '0.85rem', padding: '6px 12px' }}
          >
            {t('workspace.tabs.changes')}
          </button>
        </div>

        {/* Search bar (Files tab only) */}
        {activeTab === 'files' && (
          <FileSearch
            sessionId={activeSessionId}
            query={searchQuery}
            showHidden={showHidden}
            onQueryChange={setSearchQuery}
            onSelectFile={handleOpenFile}
            onClear={() => setSearchQuery('')}
          />
        )}
      </header>

      {/* Main Workspace Body */}
      <div
        className="workspace-body"
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {activeTab === 'changes' ? (
          <GitChangesList
            files={gitDiffData?.success ? gitDiffData.data.files : []}
            branch={gitDiffData?.success ? gitDiffData.data.branch : ''}
            baseBranch={gitDiffData?.success ? gitDiffData.data.baseBranch : ''}
            totalAdditions={gitDiffData?.success ? gitDiffData.data.totalAdditions : 0}
            totalDeletions={gitDiffData?.success ? gitDiffData.data.totalDeletions : 0}
            prStatus={prStatus}
            notGitRepo={
              !gitDiffData?.success && gitDiffData?.unavailableReason === 'not_git_repository'
            }
            loading={loadingGit}
            error={gitError}
            onSelectFile={handleOpenDiffFile}
            onRefresh={() => void loadGitDiff(activeSessionId)}
          />
        ) : searchQuery.trim() !== '' ? null : loadingFiles ? (
          <div
            className="workspace-body__loading"
            data-testid="workspace-loading"
            style={{ padding: '24px', textAlign: 'center', opacity: 0.7 }}
          >
            <p>{t('workspace.loading')}</p>
          </div>
        ) : loadError ? (
          <div
            className="workspace-body__error"
            data-testid="workspace-error"
            style={{ padding: '24px', textAlign: 'center', color: 'var(--color-danger, #d32f2f)' }}
          >
            <p>{loadError}</p>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void loadFiles(activeSessionId, showHidden)}
              style={{ marginTop: '12px' }}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <FilesTree
            items={flattenedItems}
            expandedPaths={expandedPaths}
            onToggleFolder={handleToggleFolder}
            onOpenFile={handleOpenFile}
            initialScrollTop={scrollTop}
            onScroll={handleScroll}
            emptyLabel={t('workspace.emptyFolder')}
          />
        )}
      </div>

      {/* Change Directory Sheet */}
      <ChangeDirectorySheet
        open={changeDirOpen}
        initialPath={cwd}
        sessionId={activeSessionId}
        onClose={() => setChangeDirOpen(false)}
        onChanged={(newCwd) => {
          updateCwd(activeSessionId, newCwd);
          void loadFiles(activeSessionId, showHidden);
          if (activeTab === 'changes') {
            void loadGitDiff(activeSessionId);
          }
        }}
      />
    </section>
  );
}
