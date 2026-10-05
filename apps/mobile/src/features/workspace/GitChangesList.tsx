import { useTranslation } from 'react-i18next';
import { GitBranchIcon } from '../../components/icons';
import { PullRequestChip } from './PullRequestChip';
import type { PullRequestStatusInfo } from './PullRequestChip';
import type { GitDiffFile } from '@droidmobile/daemon-client';

interface GitChangesListProps {
  files: readonly GitDiffFile[];
  branch: string;
  baseBranch: string;
  totalAdditions: number;
  totalDeletions: number;
  prStatus?: PullRequestStatusInfo | null;
  notGitRepo?: boolean;
  loading?: boolean;
  error?: string | null;
  onSelectFile: (filePath: string) => void;
  onRefresh?: () => void;
}

export function GitChangesList({
  files,
  branch,
  baseBranch,
  totalAdditions,
  totalDeletions,
  prStatus,
  notGitRepo = false,
  loading = false,
  error = null,
  onSelectFile,
  onRefresh,
}: GitChangesListProps) {
  const { t } = useTranslation();

  if (notGitRepo) {
    return (
      <div
        className="git-not-a-repo"
        data-testid="git-not-a-repo"
        style={{ padding: '32px 16px', textAlign: 'center', opacity: 0.7 }}
      >
        <p>{t('git.notGitRepo')}</p>
      </div>
    );
  }

  if (loading && files.length === 0) {
    return (
      <div
        className="git-changes-loading"
        data-testid="git-changes-loading"
        style={{ padding: '32px 16px', textAlign: 'center', opacity: 0.7 }}
      >
        <p>{t('workspace.loading')}</p>
      </div>
    );
  }

  if (error && files.length === 0) {
    return (
      <div
        className="git-changes-error"
        data-testid="git-changes-error"
        style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-danger, #d32f2f)' }}
      >
        <p>{error}</p>
        {onRefresh && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onRefresh}
            style={{ marginTop: '12px' }}
          >
            {t('common.retry')}
          </button>
        )}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div
        className="git-no-changes"
        data-testid="git-no-changes"
        style={{ padding: '32px 16px', textAlign: 'center', opacity: 0.7 }}
      >
        <p>{t('git.noChanges')}</p>
      </div>
    );
  }

  return (
    <div
      className="git-changes-container"
      data-testid="git-changes-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        // Keeps a few rows reachable when the Git actions bar is tall; the workspace body scrolls instead.
        minHeight: '144px',
        overflow: 'hidden',
      }}
    >
      {/* Changes Header */}
      <div
        className="git-changes-header"
        data-testid="git-changes-header"
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border, #eee)',
          backgroundColor: 'var(--color-surface, #fafafa)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {/* Branch & Base Branch */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
              fontSize: '0.85rem',
            }}
          >
            <GitBranchIcon width={16} height={16} />
            <span
              className="git-branch"
              data-testid="git-branch"
              style={{ fontWeight: 600, fontFamily: 'monospace' }}
            >
              {branch}
            </span>
            {baseBranch && (
              <>
                <span style={{ opacity: 0.5 }}>/</span>
                <span
                  className="git-base-branch"
                  data-testid="git-base-branch"
                  style={{ fontFamily: 'monospace', opacity: 0.75 }}
                >
                  {baseBranch}
                </span>
              </>
            )}
          </div>

          {/* Totals & PR Chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PullRequestChip status={prStatus} />

            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span
                className="chip chip--success"
                data-testid="git-total-additions"
                style={{ fontWeight: 600, fontSize: '0.8rem' }}
              >
                +{totalAdditions}
              </span>
              <span
                className="chip chip--danger"
                data-testid="git-total-deletions"
                style={{ fontWeight: 600, fontSize: '0.8rem' }}
              >
                -{totalDeletions}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Changes Files List */}
      <div
        className="git-changes-list"
        data-testid="git-changes-list"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0',
        }}
      >
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            className="git-change-row"
            data-testid={`git-change-${file.path}`}
            onClick={() => onSelectFile(file.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: '1px solid var(--color-border, #eee)',
              textAlign: 'left',
              cursor: 'pointer',
              gap: '10px',
            }}
          >
            {/* Status Badge */}
            <span
              className={`chip git-status-badge git-status-badge--${file.status}`}
              data-testid="git-status-badge"
              style={{
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                fontWeight: 700,
                letterSpacing: '0.5px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor:
                  file.status === 'added'
                    ? 'var(--diff-add-bg, rgba(27, 127, 59, 0.12))'
                    : file.status === 'deleted'
                      ? 'var(--diff-del-bg, rgba(179, 38, 30, 0.12))'
                      : 'var(--color-surface-variant, #ededf0)',
                color:
                  file.status === 'added'
                    ? 'var(--diff-add-fg, var(--color-success, #1b7f3b))'
                    : file.status === 'deleted'
                      ? 'var(--diff-del-fg, var(--color-danger, #b3261e))'
                      : 'var(--color-fg, #1b1d21)',
              }}
            >
              {t(`git.status.${file.status}`, { defaultValue: file.status })}
            </span>

            {/* File Path */}
            <span
              className="git-file-path"
              data-testid="git-file-path"
              style={{
                flex: 1,
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={file.path}
            >
              {file.path}
            </span>

            {/* Per-file Additions & Deletions */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span
                className="git-file-additions"
                data-testid="git-file-additions"
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--color-success, #1b7f3b)',
                }}
              >
                +{file.additions}
              </span>
              <span
                className="git-file-deletions"
                data-testid="git-file-deletions"
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--color-danger, #b3261e)',
                }}
              >
                -{file.deletions}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
