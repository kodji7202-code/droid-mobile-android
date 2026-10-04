import { useEffect, useState } from 'react';
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
        if (!cancelled) setDefaultModel(settings.modelId ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection]);

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
      onCreated(await connection.createSession({ cwd: valid.path }));
    } catch {
      setCreateFailed(true);
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const fieldError =
    check.state === 'invalid'
      ? check.error || t('sessions.newDirectoryInvalid')
      : check.state === 'failed'
        ? t('sessions.newDirectoryUnreachable')
        : null;

  return (
    <Sheet open onClose={onClose} title={t('sessions.newTitle')} testId="session-new-sheet">
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
        <p className="field__description" data-testid="session-new-model">
          {t('sessions.newModel', { model: defaultModel ?? t('sessions.newModelLoading') })}
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
