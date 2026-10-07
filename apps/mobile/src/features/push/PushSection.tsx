import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { checkBridgeUrl } from '../../platform/bridgeClient';
import { isDebugBuild } from '../../platform/buildFlavor';
import { qrScanner } from '../../platform/qrScanner';
import type { QrScanResult } from '../../platform/qrScanner';
import { usePushStore } from '../../stores/push';

type ScanNotice = 'noQr' | 'failed' | null;

// Attributes that keep password managers and Android autofill away from the bridge secret.
const NO_AUTOFILL = {
  autoComplete: 'off',
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-form-type': 'other',
} as const;

/**
 * Settings > Notifications > Push: registers this phone with the FCM bridge from a pasted
 * pairing code, an imported QR image or the bridge URL and secret typed by hand. The secret
 * lives in uncontrolled inputs and is cleared after use; it is never rendered or stored here.
 */
export function PushSection() {
  const { t } = useTranslation();
  const push = usePushStore();
  const secretInput = useRef<HTMLInputElement>(null);
  const pairingInput = useRef<HTMLInputElement>(null);
  const [bridgeUrl, setBridgeUrl] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [scanNotice, setScanNotice] = useState<ScanNotice>(null);
  const busy = push.status === 'registering' || push.status === 'unregistering';
  const registered = push.status === 'registered' || push.status === 'unregistering';

  useEffect(() => {
    void usePushStore.getState().refreshPending();
  }, []);

  useEffect(() => {
    if (push.pendingBridge !== null) setBridgeUrl((current) => current || push.pendingBridge || '');
  }, [push.pendingBridge]);

  const clearInputs = () => {
    if (secretInput.current) secretInput.current.value = '';
    if (pairingInput.current) pairingInput.current.value = '';
    setHasSecret(false);
  };

  const onPairingChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    // The code carries the secret: it never stays in the field, valid or not.
    event.target.value = '';
    setScanNotice(null);
    if (text.trim() === '') return;
    void push.registerFromPairingCode(text).then((ok) => {
      if (ok) setBridgeUrl('');
    });
  };

  const onScanResult = (result: QrScanResult) => {
    switch (result.status) {
      case 'ok':
        void push.registerFromPairingCode(result.text);
        return;
      case 'none':
        setScanNotice('noQr');
        return;
      case 'cancelled':
        return;
      default:
        setScanNotice('failed');
    }
  };

  const onScanImage = () => {
    setScanNotice(null);
    push.clearError();
    qrScanner.scanImage().then(onScanResult, () => setScanNotice('failed'));
  };

  const pendingMatches =
    push.pendingBridge !== null &&
    (() => {
      const check = checkBridgeUrl(bridgeUrl, isDebugBuild());
      return check.ok && check.url === push.pendingBridge;
    })();
  const canRegister = !busy && bridgeUrl.trim() !== '' && (hasSecret || pendingMatches);

  const onRegister = () => {
    const secret = secretInput.current?.value ?? '';
    void push
      .register({ bridge: bridgeUrl, secret: secret === '' ? undefined : secret })
      .then((ok) => {
        if (ok) {
          clearInputs();
          setBridgeUrl('');
        }
      });
  };

  const unregistered = push.status === 'unregistered';
  const deliveryNotStopped = push.deliveryNotStopped && unregistered;
  const removalPending = push.removalPending && unregistered;
  const statusKey = deliveryNotStopped
    ? 'deliveryNotStopped'
    : removalPending
      ? 'removalPending'
      : push.status;
  const statusLabel = t(`push.status.${statusKey}`);

  return (
    <section className="field" data-testid="settings-push" aria-labelledby="settings-push-title">
      <h3 className="settings-section-title" id="settings-push-title">
        {t('push.title')}
      </h3>
      <p className="field__description">{t('push.description')}</p>
      <p
        className="field__description"
        data-testid="settings-push-status"
        data-state={registered ? 'registered' : statusKey}
        role="status"
      >
        {statusLabel}
      </p>
      {push.removalPending && push.status !== 'unregistered' ? (
        <p className="field__description" data-testid="settings-push-removal-pending">
          {t('push.removalPendingNote')}
        </p>
      ) : null}
      {push.error && !(deliveryNotStopped && push.error === 'unregisterFailed') ? (
        <p className="field__error" data-testid="settings-push-error" role="alert">
          {t(`push.error.${push.error}`)}
        </p>
      ) : null}
      {!push.supported ? (
        <p className="field__description" data-testid="settings-push-unavailable">
          {t('push.unavailable')}
        </p>
      ) : (
        <>
          {registered ? (
            <>
              <dl className="push-details">
                <dt>{t('push.bridgeLabel')}</dt>
                <dd data-testid="settings-push-bridge">{push.bridge}</dd>
                <dt>{t('push.deviceLabel')}</dt>
                <dd data-testid="settings-push-device-label">{push.label}</dd>
                <dt>{t('push.deviceIdLabel')}</dt>
                <dd data-testid="settings-push-device-id">{push.deviceId}</dd>
              </dl>
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="settings-push-disable"
                disabled={busy}
                onClick={() => void push.unregister()}
              >
                {t('push.disable')}
              </button>
              {push.error === 'unregisterFailed' ? (
                <>
                  <p className="field__description">{t('push.disableLocalHint')}</p>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    data-testid="settings-push-disable-local"
                    disabled={busy}
                    onClick={() => void push.unregister({ force: true })}
                  >
                    {t('push.disableLocal')}
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          <label className="field__label" htmlFor="settings-push-pairing">
            {t('push.pairingLabel')}
          </label>
          <input
            id="settings-push-pairing"
            className="field__control"
            data-testid="settings-push-pairing"
            name="push-pairing-code"
            type="text"
            ref={pairingInput}
            disabled={busy}
            onChange={onPairingChange}
            aria-describedby="settings-push-pairing-hint"
            {...NO_AUTOFILL}
          />
          <p className="field__description" id="settings-push-pairing-hint">
            {registered ? t('push.replaceHint') : t('push.pairingHint')}
          </p>
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="settings-push-scan-image"
            disabled={busy}
            onClick={onScanImage}
          >
            {t('push.scanImage')}
          </button>
          {scanNotice ? (
            <p className="field__error" data-testid="settings-push-scan-notice" role="alert">
              {t(scanNotice === 'noQr' ? 'push.scanNoQr' : 'push.scanFailed')}
            </p>
          ) : null}
          {registered ? null : (
            <>
              <p className="field__description">{t('push.manualHint')}</p>
              {push.pendingBridge !== null ? (
                <div data-testid="settings-push-pending">
                  <p className="field__description">
                    {t('push.pendingNotice', { bridge: push.pendingBridge })}
                  </p>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    data-testid="settings-push-discard-pending"
                    onClick={() => void push.discardPending()}
                  >
                    {t('push.pendingDiscard')}
                  </button>
                </div>
              ) : null}
              <label className="field__label" htmlFor="settings-push-bridge-url">
                {t('push.bridgeUrlLabel')}
              </label>
              <input
                id="settings-push-bridge-url"
                className="field__control"
                data-testid="settings-push-bridge-url"
                name="push-bridge-url"
                type="text"
                inputMode="url"
                value={bridgeUrl}
                disabled={busy}
                onChange={(event) => {
                  setBridgeUrl(event.target.value);
                  push.clearError();
                }}
                {...NO_AUTOFILL}
              />
              <label className="field__label" htmlFor="settings-push-secret">
                {t('push.secretLabel')}
              </label>
              <input
                id="settings-push-secret"
                className="field__control"
                data-testid="settings-push-secret"
                name="push-bridge-token"
                type="password"
                ref={secretInput}
                disabled={busy}
                onChange={(event) => {
                  setHasSecret(event.target.value.trim() !== '');
                  push.clearError();
                }}
                {...NO_AUTOFILL}
              />
              <button
                type="button"
                className="btn btn--primary"
                data-testid="settings-push-register"
                disabled={!canRegister}
                aria-busy={push.status === 'registering'}
                onClick={onRegister}
              >
                {t('push.register')}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
