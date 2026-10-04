import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSubHeader } from './SettingsSubHeader';
import { useAuthenticate } from '../lock/useAuthenticate';
import { biometrics } from '../../platform/biometrics';
import { GRACE_OPTIONS_SECONDS, useLockStore } from '../../stores/lock';

/**
 * Settings > Security: the app lock toggle and its grace period. Turning the
 * lock on needs a screen lock or biometric and a successful prompt; turning it
 * off needs a prompt too, so a borrowed unlocked phone cannot drop the lock.
 */
export function SecurityScreen() {
  const { t } = useTranslation();
  const authenticate = useAuthenticate();
  const enabled = useLockStore((state) => state.enabled);
  const graceSeconds = useLockStore((state) => state.graceSeconds);
  const setEnabled = useLockStore((state) => state.setEnabled);
  const setGraceSeconds = useLockStore((state) => state.setGraceSeconds);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void biometrics.isAvailable().then((value) => {
      if (!cancelled) setAvailable(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    if (busy) return;
    setMessageKey(null);
    setBusy(true);
    try {
      const turningOn = !enabled;
      if (turningOn) {
        const nowAvailable = await biometrics.isAvailable();
        setAvailable(nowAvailable);
        if (!nowAvailable) {
          setMessageKey('security.notAvailable');
          return;
        }
      }
      const outcome = await authenticate(turningOn ? 'enable' : 'disable');
      if (outcome === 'success') {
        setEnabled(turningOn);
      } else if (outcome === 'unavailable') {
        setMessageKey('security.notAvailable');
      } else {
        const prefix = turningOn ? 'enable' : 'disable';
        setMessageKey(`security.${prefix}${outcome === 'cancelled' ? 'Cancelled' : 'Failed'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screen" data-testid="security-screen">
      <SettingsSubHeader title={t('security.title')} />
      <div className="field">
        <div className="settings-toggle">
          <label className="field__label" htmlFor="settings-biometric">
            {t('security.lockLabel')}
          </label>
          <input
            id="settings-biometric"
            type="checkbox"
            role="switch"
            className="settings-toggle__control"
            data-testid="settings-biometric-toggle"
            checked={enabled}
            aria-checked={enabled}
            aria-describedby="settings-biometric-description"
            onChange={() => void toggle()}
          />
        </div>
        <p className="field__description" id="settings-biometric-description">
          {t('security.lockDescription')}
        </p>
        {available === false && !enabled ? (
          <p className="field__description" data-testid="settings-biometric-unavailable">
            {t('security.notAvailable')}
          </p>
        ) : null}
        {messageKey ? (
          <p className="field__error" role="alert" data-testid="settings-biometric-message">
            {t(messageKey)}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label className="field__label" htmlFor="settings-biometric-grace">
          {t('security.graceLabel')}
        </label>
        <select
          id="settings-biometric-grace"
          className="field__control"
          data-testid="settings-biometric-grace"
          value={graceSeconds}
          onChange={(event) => setGraceSeconds(Number(event.target.value))}
        >
          {GRACE_OPTIONS_SECONDS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {t(`security.grace${seconds}`)}
            </option>
          ))}
        </select>
        <p className="field__description">{t('security.graceDescription')}</p>
      </div>
    </section>
  );
}
