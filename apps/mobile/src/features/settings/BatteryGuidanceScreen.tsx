import { useCallback, useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { SettingsSubHeader } from './SettingsSubHeader';
import { daemonService } from '../../platform/daemonService';
import type { BatteryState } from '../../platform/daemonService';

const STEP_KEYS = ['step1', 'step2', 'step3', 'step4'] as const;

/**
 * Settings > Notifications > Battery optimisation: why background limits break delivery,
 * how to set the app to unrestricted, and whether Android currently exempts it. The state
 * is read again whenever the app returns from the system settings.
 */
export function BatteryGuidanceScreen() {
  const { t } = useTranslation();
  const [state, setState] = useState<BatteryState>('unknown');
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    void daemonService.batteryState().then(setState);
  }, []);

  useEffect(() => {
    refresh();
    const resume = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) refresh();
    });
    document.addEventListener('visibilitychange', refresh);
    return () => {
      void resume.then((listener) => listener.remove());
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh]);

  const openSettings = async () => {
    setFailed(!(await daemonService.openBatterySettings()));
  };

  return (
    <section className="screen" data-testid="battery-guidance-screen">
      <SettingsSubHeader title={t('battery.title')} backTo="/settings/notifications" />
      <p className="screen__description" data-testid="battery-guidance-why">
        {t('battery.why')}
      </p>
      <h3 className="field__label">{t('battery.stepsTitle')}</h3>
      <ol className="guidance-steps" data-testid="battery-guidance-steps">
        {STEP_KEYS.map((key) => (
          <li key={key}>{t(`battery.${key}`)}</li>
        ))}
      </ol>
      <p className="field__description" data-testid="battery-guidance-state" data-state={state}>
        {t('battery.stateLabel')}: <strong>{t(`battery.state.${state}`)}</strong>
      </p>
      <button
        type="button"
        className="btn"
        data-testid="battery-guidance-open-settings"
        disabled={!daemonService.isSupported()}
        onClick={() => void openSettings()}
      >
        {t('battery.openSettings')}
      </button>
      {failed ? (
        <p className="field__error" role="alert" data-testid="battery-guidance-error">
          {t('battery.openFailed')}
        </p>
      ) : null}
    </section>
  );
}
