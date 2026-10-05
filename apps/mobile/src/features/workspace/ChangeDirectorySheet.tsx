import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useConnectionStore } from '../../stores/connection';
import { useDirectoryCheck } from '../sessions/newSession/useDirectoryCheck';

interface ChangeDirectorySheetProps {
  open: boolean;
  initialPath: string;
  sessionId: string;
  onClose: () => void;
  onChanged: (newCwd: string) => void;
}

const TRUST_RETRY_DELAYS_MS = [250, 500, 1000];

function isNotTrustedError(err: unknown): boolean {
  return /not trusted/i.test(err instanceof Error ? err.message : String(err));
}

export function ChangeDirectorySheet({
  open,
  initialPath,
  sessionId,
  onClose,
  onChanged,
}: ChangeDirectorySheetProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const [directory, setDirectory] = useState(initialPath);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showTrustDialog, setShowTrustDialog] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDirectory(initialPath);
      setChangeError(null);
      setShowTrustDialog(false);
      setBusy(false);
    }
  }, [open, initialPath]);

  const check = useDirectoryCheck(connection, directory, revision);

  const fieldError =
    check.state === 'invalid'
      ? check.error || t('workspace.invalidDirectory')
      : check.state === 'failed'
        ? t('sessions.newCheckFailed')
        : changeError;

  const valid = check.state === 'valid' ? check : null;
  const canSubmit = valid !== null && !busy;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !connection || busy) return;

    if (valid.trustRequired) {
      setShowTrustDialog(true);
      return;
    }

    void executeChange(valid.path, false);
  };

  const executeChange = async (targetPath: string, shouldTrust: boolean) => {
    if (!connection || busy) return;
    setBusy(true);
    setChangeError(null);

    try {
      if (shouldTrust && valid) {
        await connection.trustFolder(valid.trustRoot || targetPath);
      }
      let res;
      for (let attempt = 0; ; attempt += 1) {
        try {
          res = await connection.changeDirectory({ sessionId, workingDirectory: targetPath });
          break;
        } catch (err) {
          // Only the window right after an accepted trust may still answer "not trusted".
          if (!shouldTrust || attempt >= TRUST_RETRY_DELAYS_MS.length || !isNotTrustedError(err)) {
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, TRUST_RETRY_DELAYS_MS[attempt]));
        }
      }
      onChanged(res.resolvedPath);
      onClose();
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : String(err));
      setRevision((r) => r + 1);
    } finally {
      setBusy(false);
      setShowTrustDialog(false);
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={t('workspace.changeDirectoryTitle')}>
        <form onSubmit={handleSubmit} className="change-directory-form">
          <label className="field__label" htmlFor="change-directory-input">
            {t('workspace.changeDirectoryPlaceholder')}
          </label>
          <input
            id="change-directory-input"
            className="field__control"
            data-testid="change-directory-input"
            value={directory}
            onChange={(e) => {
              setDirectory(e.target.value);
              setChangeError(null);
            }}
            placeholder={t('workspace.changeDirectoryPlaceholder')}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          {fieldError ? (
            <p
              className="field__error"
              id="change-directory-error"
              role="alert"
              data-testid="change-directory-error"
            >
              {fieldError}
            </p>
          ) : null}
          {check.state === 'checking' ? (
            <p className="field__description" role="status" data-testid="change-directory-checking">
              {t('sessions.newChecking')}
            </p>
          ) : null}

          <div
            className="sheet__actions"
            style={{ marginTop: '16px', display: 'flex', gap: '8px' }}
          >
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="change-directory-cancel"
              onClick={onClose}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              data-testid="change-directory-submit"
              disabled={!canSubmit}
            >
              {t('workspace.change')}
            </button>
          </div>
        </form>
      </Sheet>

      {valid ? (
        <ConfirmDialog
          open={showTrustDialog}
          title={t('workspace.trustTitle')}
          message={t('workspace.trustMessage', { path: valid.trustRoot || valid.path })}
          confirmLabel={t('workspace.trustAccept')}
          cancelLabel={t('workspace.trustDecline')}
          testId="trust-dialog"
          onConfirm={() => void executeChange(valid.path, true)}
          onCancel={() => setShowTrustDialog(false)}
        />
      ) : null}
    </>
  );
}
