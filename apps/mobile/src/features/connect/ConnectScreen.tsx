import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useConnectionStore } from '../../stores/connection';
import { messageKeyFor } from './errors';
import type { ConnectErrorKey } from './errors';
import { isDebugBuild } from '../../platform/buildFlavor';
import { loadSavedConnections } from '../../platform/savedConnections';
import type { SavedConnection } from '../../platform/savedConnections';
import { qrScanner } from '../../platform/qrScanner';
import type { QrScanResult } from '../../platform/qrScanner';
import { getSecureStore } from '../../platform/secureStore';
import { parsePairingCode, PENDING_BRIDGE_SECRET_ID } from './pairing';
import type { PairingPayload } from './pairing';
import { checkDaemonUrl, isApiKeyFormat, isCleartextUrl } from './validation';

function savedActive(): SavedConnection | undefined {
  const { activeId, connections } = loadSavedConnections();
  return connections.find((entry) => entry.id === activeId);
}

function initialUrl(): string {
  return savedActive()?.url ?? '';
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
  const [saved] = useState(savedActive);
  // Uncontrolled: React mirrors a controlled input's value into its `value`
  // attribute, which would put the key into the serialized DOM.
  const keyInput = useRef<HTMLInputElement>(null);
  const [hasKey, setHasKey] = useState(false);
  const [pairing, setPairing] = useState('');
  const [pairingError, setPairingError] = useState(false);
  const [scanNotice, setScanNotice] = useState<'unavailable' | 'denied' | 'failed' | null>(null);
  const [scanning, setScanning] = useState(false);
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

  const applyPayload = (payload: PairingPayload) => {
    setUrl(payload.url);
    if (payload.key !== undefined && keyInput.current) {
      keyInput.current.value = payload.key;
      setHasKey(true);
    }
    if (payload.bridge !== undefined && payload.bridgeSecret !== undefined) {
      const bridge = JSON.stringify({ bridge: payload.bridge, bridgeSecret: payload.bridgeSecret });
      getSecureStore()
        .setSecret(PENDING_BRIDGE_SECRET_ID, bridge)
        .catch(() => undefined);
    }
    setPairing('');
    setPairingError(false);
    setErrorKey(null);
  };

  const onPairingChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    setScanNotice(null);
    if (text.trim() === '') {
      setPairing('');
      setPairingError(false);
      return;
    }
    const payload = parsePairingCode(text);
    if (payload === null) {
      // A rejected code may still embed a key or bridge secret; never keep it in the field.
      setPairing('');
      setPairingError(true);
      return;
    }
    applyPayload(payload);
  };

  const onScanResult = (result: QrScanResult) => {
    switch (result.status) {
      case 'ok': {
        const payload = parsePairingCode(result.text);
        if (payload === null) {
          setPairingError(true);
          return;
        }
        applyPayload(payload);
        return;
      }
      case 'none':
        setPairingError(true);
        return;
      case 'unavailable':
        setScanNotice('unavailable');
        return;
      case 'denied':
        setScanNotice('denied');
        return;
      case 'error':
        setScanNotice('failed');
        return;
      case 'cancelled':
        return;
    }
  };

  const onScan = (scan: () => Promise<QrScanResult>) => {
    setScanNotice(null);
    setPairingError(false);
    scan()
      .then(onScanResult, () => setScanNotice('failed'))
      .finally(() => setScanning(false));
  };
  const onSubmit = (event: FormEvent) => {
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
      {saved ? (
        <p className="field__description" data-testid="connect-saved-connection">
          {t('connect.savedConnection', { label: saved.label, url: saved.url })}
        </p>
      ) : null}
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
      {scanning ? (
        <div className="qr-scan-overlay">
          <button
            type="button"
            className="btn btn--secondary qr-scan-overlay__cancel"
            data-testid="connect-scan-cancel"
            onClick={() => void qrScanner.stopCamera()}
          >
            {t('connect.scanCancel')}
          </button>
        </div>
      ) : null}
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
          onClick={() => onScan(() => qrScanner.scanCamera(() => setScanning(true)))}
        >
          {t('connect.scanQr')}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="connect-scan-image"
          onClick={() => onScan(() => qrScanner.scanImage())}
        >
          {t('connect.scanImage')}
        </button>
        {scanNotice ? (
          <p className="field__description" data-testid="connect-scan-notice" role="status">
            {scanNotice === 'denied'
              ? t('connect.scanDenied')
              : scanNotice === 'failed'
                ? t('connect.scanFailed')
                : t('connect.scanUnavailable')}
          </p>
        ) : null}
      </div>
    </section>
  );
}
