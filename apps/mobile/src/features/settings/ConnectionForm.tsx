import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MissingKeyError } from '../../stores/connection';
import { isDebugBuild } from '../../platform/buildFlavor';
import { checkDaemonUrl, isApiKeyFormat, isCleartextUrl } from '../connect/validation';
import { messageKeyFor } from '../connect/errors';

export interface ConnectionFormValues {
  label: string;
  url: string;
  apiKey: string;
}

interface ConnectionFormProps {
  mode: 'add' | 'edit';
  initial?: { label: string; url: string };
  onSubmit(values: ConnectionFormValues): Promise<void>;
  onCancel(): void;
}

/**
 * Add/edit form. The key field is uncontrolled and always starts empty (also
 * when editing): a stored key is never read back into the UI.
 */
export function ConnectionForm({ mode, initial, onSubmit, onCancel }: ConnectionFormProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(initial?.label ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const keyInput = useRef<HTMLInputElement>(null);
  const [hasKey, setHasKey] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const keyRequired = mode === 'add';
  const canSubmit = url.trim() !== '' && (hasKey || !keyRequired) && !busy;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !canSubmit) return;

    const urlCheck = checkDaemonUrl(url, isDebugBuild());
    if (!urlCheck.ok) {
      setErrorKey(
        urlCheck.reason === 'insecure' ? 'connect.errorInsecure' : 'connect.errorUrlFormat',
      );
      return;
    }
    const apiKey = keyInput.current?.value.trim() ?? '';
    if (apiKey !== '' && !isApiKeyFormat(apiKey)) {
      setErrorKey('connect.errorKeyFormat');
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setErrorKey(null);
    onSubmit({ label, url: urlCheck.url, apiKey })
      .catch((error: unknown) => {
        setErrorKey(
          error instanceof MissingKeyError ? 'connections.errorMissingKey' : messageKeyFor(error),
        );
      })
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };

  return (
    <form
      className="connect-form connection-form"
      data-testid="connection-form"
      onSubmit={submit}
      noValidate
    >
      <h3 className="connection-form__title">
        {mode === 'add' ? t('connections.addTitle') : t('connections.editTitle')}
      </h3>
      <div className="field">
        <label className="field__label" htmlFor="connection-form-label">
          {t('connections.labelField')}
        </label>
        <input
          id="connection-form-label"
          className="field__control"
          data-testid="connection-form-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="connection-form-url">
          {t('connect.urlLabel')}
        </label>
        <input
          id="connection-form-url"
          className="field__control"
          data-testid="connection-form-url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setErrorKey(null);
          }}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          inputMode="url"
          spellCheck={false}
        />
      </div>
      {isDebugBuild() && isCleartextUrl(url) ? (
        <p className="connect-banner" data-testid="connection-form-insecure" role="status">
          {t('connect.insecureBanner')}
        </p>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor="connection-form-key">
          {t('connect.keyLabel')}
        </label>
        <input
          id="connection-form-key"
          className="field__control"
          data-testid="connection-form-key"
          type="password"
          ref={keyInput}
          onChange={(event) => {
            setHasKey(event.target.value.trim() !== '');
            setErrorKey(null);
          }}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />
        {mode === 'edit' ? (
          <p className="field__description">{t('connections.keyEditHint')}</p>
        ) : null}
      </div>
      {errorKey ? (
        <p className="field__error" data-testid="connection-form-error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}
      <div className="dialog__actions">
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="connection-form-cancel"
          onClick={onCancel}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="connection-form-submit"
          disabled={!canSubmit}
          aria-busy={busy}
        >
          {busy ? t('connections.saving') : t('connections.save')}
        </button>
      </div>
    </form>
  );
}
