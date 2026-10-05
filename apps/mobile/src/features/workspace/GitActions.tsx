import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranchIcon } from '../../components/icons';
import { useConnectionStore } from '../../stores/connection';
import { BranchSwitcherSheet } from './BranchSwitcherSheet';
import { CommitSheet } from './CommitSheet';
import { CreatePrSheet } from './CreatePrSheet';
import type { DaemonCreatePRResult, GitDiffFile } from '@droidmobile/daemon-client';

interface GitActionsProps {
  sessionId: string;
  cwd: string;
  branch: string;
  baseBranch: string;
  pushableCommitCount?: number;
  files: readonly GitDiffFile[];
  online: boolean;
  onRefresh: () => void;
}

type Notice = { kind: 'success' | 'error'; testId: string; text: string };

export function GitActions({
  sessionId,
  cwd,
  branch,
  baseBranch,
  pushableCommitCount,
  files,
  online,
  onRefresh,
}: GitActionsProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((s) => s.connection);
  const [branchOpen, setBranchOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createdPr, setCreatedPr] = useState<DaemonCreatePRResult | null>(null);

  const handlePush = async () => {
    if (!connection || pushing || !online) return;
    setPushing(true);
    setNotice(null);
    try {
      const result = await connection.pushGitBranch(sessionId);
      if (result.success) {
        setNotice({ kind: 'success', testId: 'git-push-success', text: t('git.push.success') });
        onRefresh();
      } else {
        setNotice({ kind: 'error', testId: 'git-action-error', text: t('git.push.failed') });
      }
    } catch (err) {
      setNotice({
        kind: 'error',
        testId: 'git-action-error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div
      className="git-actions"
      data-testid="git-actions"
      style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--color-border, #eee)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          data-testid="git-branch-button"
          disabled={!online}
          onClick={() => setBranchOpen(true)}
          style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <GitBranchIcon width={16} height={16} />
          <span data-testid="git-current-branch" style={{ fontFamily: 'monospace' }}>
            {branch || t('git.branches.detached')}
          </span>
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          data-testid="git-commit-button"
          disabled={!online}
          onClick={() => {
            setNotice(null);
            setCommitOpen(true);
          }}
          style={{ minHeight: 48 }}
        >
          {t('git.commit.button')}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          data-testid="git-push-button"
          disabled={!online || pushing}
          onClick={() => void handlePush()}
          style={{ minHeight: 48 }}
        >
          {pushing ? t('git.push.pushing') : t('git.push.button')}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          data-testid="git-create-pr-button"
          disabled={!online}
          onClick={() => setPrOpen(true)}
          style={{ minHeight: 48 }}
        >
          {t('git.pr.createButton')}
        </button>
        {pushableCommitCount !== undefined ? (
          <span className="chip" data-testid="git-pushable-count">
            {t('git.push.pending', { count: pushableCommitCount })}
          </span>
        ) : null}
      </div>
      {!online ? (
        <p role="status" data-testid="git-offline" style={{ margin: 0, opacity: 0.8 }}>
          {t('git.offline')}
        </p>
      ) : null}
      {notice ? (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          data-testid={notice.testId}
          style={{
            margin: 0,
            color: notice.kind === 'error' ? 'var(--color-danger, #d32f2f)' : undefined,
          }}
        >
          {notice.text}
        </p>
      ) : null}
      {createdPr ? (
        <p data-testid="git-pr-card" style={{ margin: 0 }}>
          <a href={createdPr.url} target="_blank" rel="noreferrer">
            #{createdPr.number} {createdPr.title}
          </a>
        </p>
      ) : null}

      <BranchSwitcherSheet
        open={branchOpen}
        cwd={cwd}
        online={online}
        onClose={() => setBranchOpen(false)}
        onChanged={onRefresh}
      />
      <CommitSheet
        open={commitOpen}
        sessionId={sessionId}
        files={files}
        online={online}
        onClose={() => setCommitOpen(false)}
        onAttempt={() => setNotice(null)}
        onCommitted={() => {
          setNotice({
            kind: 'success',
            testId: 'git-commit-success',
            text: t('git.commit.success'),
          });
          onRefresh();
        }}
      />
      <CreatePrSheet
        open={prOpen}
        sessionId={sessionId}
        defaultBaseBranch={baseBranch}
        online={online}
        onClose={() => setPrOpen(false)}
        onCreated={(pr) => {
          setCreatedPr(pr);
          onRefresh();
        }}
      />
    </div>
  );
}
