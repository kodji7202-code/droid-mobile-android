import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useConnectionStore, TransportPolicyError } from '../../stores/connection';
import { isDebugBuild } from '../../platform/buildFlavor';
import { loadSavedConnections } from '../../platform/savedConnections';
import { parsePairingCode } from './pairing';
import { checkDaemonUrl, isApiKeyFormat, isCleartextUrl } from './validation';

type ConnectErrorKey =
  | 'connect.errorUrlFormat'
  | 'connect.errorInsecure'
  | 'connect.errorKeyFormat'
  | 'connect.errorKeyRejected'
  | 'connect.errorUnreachable'
  | 'connect.error';

/** Maps a rejected connect to a message; only the typed `kind` is trusted. */
function messageKeyFor(error: unknown): ConnectErrorKey {
  if (error instanceof TransportPolicyError) {
    return error.reason === 'insecure' ? 'connect.errorInsecure' : 'connect.errorUrlFormat';
  }
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (kind === 'auth') return 'connect.errorKeyRejected';
  if (kind === 'connection') return 'connect.errorUnreachable';
  return 'connect.error';
}

function initialUrl(): string {
  const { activeId, connections } = loadSavedConnections();
  return connections.find((entry) => entry.id === activeId)?.url ?? '';
}

/**
 * Onboarding screen. Everything is validated locally before a socket exists;
 * the key stays in component state and the in-memory secure store, never in
 * the DOM text, URL or history (WEB-KEY-RULE).
 */
export function ConnectScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connect = useConnectionStore((state) => state.connect);
  const [url, setUrl] = useState(initialUrl);
  // Uncontrolled: React mirrors a controlled input's value into its `value`
  // attribute, which would put the key into the serialized DOM.
  const keyInput = useRef<HTMLInputElement>(null);
  const [hasKey, setHasKey] = useState(false);
  const [pairing, setPairing] = useState('');
  const [pairingError, setPairingError] = useState(false);
  const [scanNotice, setScanNotice] = useState(false);
  const [errorKey, setErrorKey] = useState<ConnectErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const canSubmit = url.trim() !== '' && hasKey && !busy;
  const showInsecureBanner = isDebugBuild() && isCleartextUrl(url);

  const onUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
    setErrorKey(null);
  };

  const onKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setHasKey(event.target.value.trim() !== '');
    setErrorKey(null);
  };

  const onPairingChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    setScanNotice(false);
    if (text.trim() === '') {
      setPairing('');
      setPairingError(false);
      return;
    }
    const payload = parsePairingCode(text);
    if (payload === null) {
      setPairing(text);
      setPairingError(true);
      return;
    }
    setUrl(payload.url);
    if (payload.key !== undefined && keyInput.current) {
      keyInput.current.value = payload.key;
      setHasKey(true);
    }
    setPairing('');
    setPairingError(false);
    setErrorKey(null);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !canSubmit) return;

    const urlCheck = checkDaemonUrl(url, isDebugBuild());
    if (!urlCheck.ok) {
      setErrorKey(urlCheck.reason === 'insecure' ? 'connect.errorInsecure' : 'connect.errorUrlFormat');
      return;
    }
    const apiKey = keyInput.current?.value.trim() ?? '';
    if (!isApiKeyFormat(apiKey)) {
      setErrorKey('connect.errorKeyFormat');
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setErrorKey(null);
    connect(urlCheck.url, apiKey)
      .then(() => navigate('/sessions', { replace: true }))
      .catch((error: unknown) => setErrorKey(messageKeyFor(error)))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };

  return (
    <section
      className="screen connect-screen"
      data-testid="connect-screen"
      aria-labelledby="connect-title"
    >
      <h1 id="connect-title">{t('connect.title')}</h1>
      <p className="screen__description">{t('connect.description')}</p>
      <form className="connect-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="connect-url">
            {t('connect.urlLabel')}
          </label>
          <input
            id="connect-url"
            className="field__control"
            data-testid="connect-url-input"
            value={url}
            onChange={onUrlChange}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            inputMode="url"
            spellCheck={false}
          />
        </div>
        {showInsecureBanner ? (
          <p className="connect-banner" data-testid="connect-insecure-banner" role="status">
            {t('connect.insecureBanner')}
          </p>
        ) : null}
        <div className="field">
          <label className="field__label" htmlFor="connect-key">
            {t('connect.keyLabel')}
          </label>
          <input
            id="connect-key"
            className="field__control"
            data-testid="connect-key-input"
            type="password"
            ref={keyInput}
            onChange={onKeyChange}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {errorKey ? (
          <p className="field__error" data-testid="connect-error" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="connect-submit"
          disabled={!canSubmit}
          aria-busy={busy}
        >
          {busy ? t('connect.submitting') : t('connect.submit')}
        </button>
      </form>
      <div className="connect-pairing">
        <div className="field">
          <label className="field__label" htmlFor="connect-pairing">
            {t('connect.pairingLabel')}
          </label>
          <input
            id="connect-pairing"
            className="field__control"
            data-testid="connect-paste-pairing"
            value={pairing}
            onChange={onPairingChange}
            aria-invalid={pairingError}
            aria-describedby="connect-pairing-hint"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="field__description" id="connect-pairing-hint">
            {t('connect.pairingHint')}
          </p>
          {pairingError ? (
            <p className="field__error" data-testid="connect-pairing-error" role="alert">
              {t('connect.pairingInvalid')}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="connect-scan-qr"
          onClick={() => setScanNotice(true)}
        >
          {t('connect.scanQr')}
        </button>
        {scanNotice ? (
          <p className="field__description" data-testid="connect-scan-notice" role="status">
            {t('connect.scanUnavailable')}
          </p>
        ) : null}
      </div>
    </section>
  );
}
