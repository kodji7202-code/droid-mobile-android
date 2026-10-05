import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';
import { useConnectionStore } from '../../stores/connection';
import type { DaemonCreatePRResult } from '@droidmobile/daemon-client';

interface CreatePrSheetProps {
  open: boolean;
  sessionId: string;
  defaultBaseBranch: string;
  online: boolean;
  onClose: () => void;
  onCreated: (pr: DaemonCreatePRResult) => void;
}

export function CreatePrSheet({
  open,
  sessionId,
  defaultBaseBranch,
  online,
  onClose,
  onCreated,
}: CreatePrSheetProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((s) => s.connection);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch);
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBaseBranch(defaultBaseBranch);
      setError(null);
      setBusy(false);
    }
  }, [open, defaultBaseBranch]);

  const canSubmit = online && !busy && title.trim() !== '' && baseBranch.trim() !== '';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const pr = await connection.createPullRequest({
        sessionId,
        title: title.trim(),
        body,
        baseBranch: baseBranch.trim(),
        draft,
      });
      setTitle('');
      setBody('');
      setDraft(false);
      onCreated(pr);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('git.pr.createTitle')} testId="pr-sheet">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label className="field__label" htmlFor="git-pr-title">
          {t('git.pr.titleLabel')}
        </label>
        <input
          id="git-pr-title"
          className="field__control"
          data-testid="git-pr-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label className="field__label" htmlFor="git-pr-body">
          {t('git.pr.bodyLabel')}
        </label>
        <textarea
          id="git-pr-body"
          className="field__control"
          data-testid="git-pr-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <label className="field__label" htmlFor="git-pr-base">
          {t('git.pr.baseLabel')}
        </label>
        <input
          id="git-pr-base"
          className="field__control"
          data-testid="git-pr-base"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48 }}>
          <input
            type="checkbox"
            data-testid="git-pr-draft"
            checked={draft}
            onChange={(e) => setDraft(e.target.checked)}
          />
          {t('git.pr.draftLabel')}
        </label>
        {error ? (
          <p className="field__error" role="alert" data-testid="git-pr-error">
            {error}
          </p>
        ) : null}
        {!online ? (
          <p role="status" data-testid="git-pr-offline">
            {t('git.offline')}
          </p>
        ) : null}
        <div className="sheet__actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="git-pr-cancel"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            data-testid="git-pr-submit"
            disabled={!canSubmit}
          >
            {busy ? t('git.pr.creating') : t('git.pr.submit')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
