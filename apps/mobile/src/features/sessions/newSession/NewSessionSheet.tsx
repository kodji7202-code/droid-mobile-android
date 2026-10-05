import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DaemonConnection, SessionHandle } from '@droidmobile/daemon-client';
import { Sheet } from '../../../components/Sheet';
import { useDirectoryCheck } from './useDirectoryCheck';

interface NewSessionSheetProps {
  connection: DaemonConnection | null;
  /** Working directories of recent sessions, offered as one-tap choices. */
  suggestions: readonly string[];
  onCreated(handle: SessionHandle): void;
  onClose(): void;
}

export function NewSessionSheet({
  connection,
  suggestions,
  onCreated,
  onClose,
}: NewSessionSheetProps) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const check = useDirectoryCheck(connection, directory, revision);

  useEffect(() => {
    let cancelled = false;
    void connection
      ?.getDefaultSettings()
      .then((settings) => {
        // An absent modelId means the daemon applies its own configured default.
        if (!cancelled) setDefaultModel(settings.modelId ?? '');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // Set once the sheet is dismissed or unmounted so a pending trust/create
  // continuation neither creates a session nor navigates.
  const dismissed = useRef(false);
  useEffect(() => {
    dismissed.current = false;
    return () => {
      dismissed.current = true;
    };
  }, []);
  const dismiss = () => {
    dismissed.current = true;
    onClose();
  };

  const valid = check.state === 'valid' ? check : null;
  const canCreate = valid !== null && !busy;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !connection || busy) {
      return;
    }
    setBusy(true);
    setCreateFailed(false);
    try {
      if (valid.trustRequired) {
        await connection.trustFolder(valid.path);
      }
      if (dismissed.current) return;
      const handle = await connection.createSession(
        useWorktree ? { cwd: valid.path, worktree: true } : { cwd: valid.path },
      );
      if (dismissed.current) {
        void handle.close().catch(() => undefined);
        return;
      }
      onCreated(handle);
    } catch {
      if (dismissed.current) return;
      setCreateFailed(true);
      setRevision((value) => value + 1);
    } finally {
      if (!dismissed.current) setBusy(false);
    }
  };

  const fieldError =
    check.state === 'invalid'
      ? check.error || t('sessions.newDirectoryInvalid')
      : check.state === 'failed'
        ? t('sessions.newDirectoryUnreachable')
        : null;

  return (
    <Sheet open onClose={dismiss} title={t('sessions.newTitle')} testId="session-new-sheet">
      <form className="field new-session" onSubmit={(event) => void create(event)}>
        <label className="field__label" htmlFor="session-new-cwd">
          {t('sessions.newDirectoryLabel')}
        </label>
        <input
          id="session-new-cwd"
          className="field__control"
          data-testid="session-new-cwd"
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          placeholder={t('sessions.newDirectoryPlaceholder')}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={fieldError !== null}
          aria-describedby={fieldError ? 'session-new-error' : undefined}
          autoFocus
        />
        {fieldError ? (
          <p
            className="field__error"
            id="session-new-error"
            role="alert"
            data-testid="session-new-error"
          >
            {fieldError}
          </p>
        ) : null}
        {check.state === 'checking' ? (
          <p className="field__description" role="status" data-testid="session-new-checking">
            {t('sessions.newChecking')}
          </p>
        ) : null}
        {suggestions.length > 0 ? (
          <ul className="new-session__suggestions" aria-label={t('sessions.newRecent')}>
            {suggestions.map((path, index) => (
              <li key={path}>
                <button
                  type="button"
                  className="btn btn--secondary new-session__suggestion"
                  data-testid={`session-new-suggestion-${index}`}
                  onClick={() => setDirectory(path)}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {valid?.trustRequired ? (
          <div className="new-session__trust" role="group" data-testid="session-new-trust">
            <p className="new-session__trust-title">{t('sessions.trustTitle')}</p>
            <p>{t('sessions.trustMessage', { path: valid.trustRoot })}</p>
          </div>
        ) : null}
        <label className="new-session__toggle" htmlFor="session-new-worktree">
          <input
            id="session-new-worktree"
            type="checkbox"
            data-testid="session-new-worktree"
            checked={useWorktree}
            onChange={(event) => setUseWorktree(event.target.checked)}
          />
          <span>{t('sessions.worktreeToggle')}</span>
        </label>
        {useWorktree ? (
          <p className="field__description" data-testid="session-new-worktree-help">
            {t('sessions.worktreeHelp')}
          </p>
        ) : null}
        <p className="field__description" data-testid="session-new-model">
          {t('sessions.newModel', {
            model:
              defaultModel === null
                ? t('sessions.newModelLoading')
                : defaultModel || t('sessions.newModelDaemonDefault'),
          })}
        </p>
        {createFailed ? (
          <p className="field__error" role="alert" data-testid="session-new-create-error">
            {t('sessions.newCreateFailed')}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="session-new-create"
          disabled={!canCreate}
        >
          {valid?.trustRequired ? t('sessions.trustAndCreate') : t('sessions.create')}
        </button>
      </form>
    </Sheet>
  );
}
