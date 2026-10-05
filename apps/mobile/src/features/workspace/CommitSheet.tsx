import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';
import { useConnectionStore } from '../../stores/connection';
import { unquoteGitPath } from './diffParser';
import type { GitDiffFile } from '@droidmobile/daemon-client';

interface CommitSheetProps {
  open: boolean;
  sessionId: string;
  files: readonly GitDiffFile[];
  online: boolean;
  onClose: () => void;
  onCommitted: () => void;
  /** Called when a commit attempt starts, so the parent can drop a stale outcome notice. */
  onAttempt?: () => void;
}

export function CommitSheet({
  open,
  sessionId,
  files,
  online,
  onClose,
  onCommitted,
  onAttempt,
}: CommitSheetProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((s) => s.connection);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMessage('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const canSubmit = online && !busy && message.trim() !== '';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection || !canSubmit) return;
    setBusy(true);
    setError(null);
    onAttempt?.();
    try {
      const result = await connection.commitGitChanges(sessionId, message.trim());
      if (!result.success) {
        setError(t('git.commit.failed'));
        return;
      }
      onCommitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('git.commit.title')} testId="commit-sheet">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <p data-testid="git-commit-files-title">
          {t('git.commit.filesTitle', { count: files.length })}
        </p>
        <ul
          data-testid="git-commit-files"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 8px',
            maxHeight: '25vh',
            overflowY: 'auto',
          }}
        >
          {files.map((f) => {
            const displayPath = unquoteGitPath(f.path);
            return (
              <li
                key={f.path}
                data-testid={`git-commit-file-${displayPath}`}
                style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
              >
                {t(`git.status.${f.status}`, { defaultValue: f.status })} {displayPath}
              </li>
            );
          })}
        </ul>
        <label className="field__label" htmlFor="git-commit-message">
          {t('git.commit.message')}
        </label>
        <textarea
          id="git-commit-message"
          className="field__control"
          data-testid="git-commit-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {error ? (
          <p className="field__error" role="alert" data-testid="git-commit-error">
            {error}
          </p>
        ) : null}
        {!online ? (
          <p role="status" data-testid="git-commit-offline">
            {t('git.offline')}
          </p>
        ) : null}
        <div className="sheet__actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="git-commit-cancel"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            data-testid="git-commit-submit"
            disabled={!canSubmit}
          >
            {busy ? t('git.commit.committing') : t('git.commit.submit')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
