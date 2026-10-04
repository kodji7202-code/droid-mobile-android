import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useConnectionStore } from '../../stores/connection';

/**
 * Minimal connect screen (placeholder until the onboarding feature replaces
 * it with the full ONBOARD contract flow: masked entry, QR, pairing,
 * specific error mapping). Enough to establish a real daemon connection so
 * the shell's connection-status can be verified end to end. The key stays in
 * memory only (WEB-KEY-RULE).
 */
export function ConnectScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connect = useConnectionStore((state) => state.connect);
  const status = useConnectionStore((state) => state.status);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [failed, setFailed] = useState(false);

  const connecting = status === 'connecting' || status === 'authenticating';
  const canSubmit = url.trim() !== '' && apiKey !== '' && !connecting;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFailed(false);
    void connect(url.trim(), apiKey)
      .then(() => navigate('/sessions', { replace: true }))
      .catch(() => setFailed(true));
  };

  return (
    <section
      className="screen connect-screen"
      data-testid="connect-screen"
      aria-labelledby="connect-title"
    >
      <h1 id="connect-title">{t('connect.title')}</h1>
      <p className="screen__description">{t('connect.description')}</p>
      <form className="connect-form" onSubmit={onSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="connect-url">
            {t('connect.urlLabel')}
          </label>
          <input
            id="connect-url"
            className="field__control"
            data-testid="connect-url-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="url"
            inputMode="url"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="connect-key">
            {t('connect.keyLabel')}
          </label>
          <input
            id="connect-key"
            className="field__control"
            data-testid="connect-key-input"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {failed ? (
          <p className="field__error" data-testid="connect-error" role="alert">
            {t('connect.error')}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="connect-submit"
          disabled={!canSubmit}
        >
          {connecting ? t('connect.submitting') : t('connect.submit')}
        </button>
      </form>
    </section>
  );
}
