import { useState } from 'react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SettingsSubHeader } from './SettingsSubHeader';
import { useNotificationPermission } from './useNotificationPermission';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChevronRightIcon } from '../../components/icons';
import { PushSection } from '../push/PushSection';
import { appNotifications } from '../../platform/appNotifications';
import { daemonService } from '../../platform/daemonService';
import { useNotificationSettingsStore } from '../../stores/notificationSettings';
import { useStayConnectedStore } from '../../stores/stayConnected';

type Channel = 'approvals' | 'turns';

/**
 * Settings > Notifications: the master switch with the Android permission flow (rationale,
 * system dialog, a way to the system settings after a refusal), one switch per notification
 * channel, "Stay connected", the push registration with the FCM bridge and the entry to the
 * battery-optimisation guidance.
 */
export function NotificationsScreen() {
  const { t } = useTranslation();
  const stayConnected = useStayConnectedStore((state) => state.enabled);
  const setStayConnected = useStayConnectedStore((state) => state.setEnabled);
  const stayConnectedSupported = daemonService.isSupported();
  const wanted = useNotificationSettingsStore((state) => state.enabled);
  const setWanted = useNotificationSettingsStore((state) => state.setEnabled);
  const approvals = useNotificationSettingsStore((state) => state.approvals);
  const turns = useNotificationSettingsStore((state) => state.turns);
  const setChannel = useNotificationSettingsStore((state) => state.setChannel);
  const supported = appNotifications.isSupported();
  const { granted, setGranted } = useNotificationPermission(appNotifications);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const channels: Record<Channel, boolean> = { approvals, turns };

  const masterOn = supported && wanted && granted === true;

  const toggleMaster = async (turnOn: boolean) => {
    if (!turnOn) {
      setWanted(false);
      return;
    }
    if (await appNotifications.permissionGranted()) {
      setGranted(true);
      setWanted(true);
      return;
    }
    setRationaleOpen(true);
  };

  const confirmRationale = async () => {
    setRationaleOpen(false);
    const allowed = await appNotifications.requestPermission();
    setGranted(allowed);
    // Kept on after a refusal: allowing it later in the system settings then turns the switch on by itself.
    setWanted(true);
  };

  return (
    <section className="screen" data-testid="notifications-screen">
      <SettingsSubHeader title={t('notifications.title')} />
      <div className="field">
        <div className="settings-toggle">
          <label className="field__label" htmlFor="settings-notifications">
            {t('notifications.master')}
          </label>
          <input
            id="settings-notifications"
            type="checkbox"
            role="switch"
            className="settings-toggle__control"
            data-testid="settings-notifications-toggle"
            checked={masterOn}
            aria-checked={masterOn}
            disabled={!supported}
            aria-describedby="settings-notifications-description"
            onChange={(event) => void toggleMaster(event.target.checked)}
          />
        </div>
        <p className="field__description" id="settings-notifications-description">
          {t('notifications.masterDescription')}
        </p>
        {supported ? (
          <p
            className="field__description"
            data-testid="settings-notifications-permission"
            data-state={granted === null ? 'unknown' : granted ? 'granted' : 'denied'}
          >
            {t('notifications.permission.label')}:{' '}
            {granted === null
              ? '…'
              : t(granted ? 'notifications.permission.granted' : 'notifications.permission.denied')}
          </p>
        ) : (
          <p className="field__description" data-testid="settings-notifications-unsupported">
            {t('notifications.notAvailable')}
          </p>
        )}
        {supported && granted === false ? (
          <div data-testid="notifications-denied">
            <p className="field__description">{t('notifications.denied')}</p>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="notifications-open-settings"
              onClick={() => void appNotifications.openSettings()}
            >
              {t('notifications.openSettings')}
            </button>
          </div>
        ) : null}
      </div>
      <h3 className="settings-section-title">{t('notifications.channelsTitle')}</h3>
      {(['approvals', 'turns'] as const).map((channel) => (
        <div className="field" key={channel}>
          <div className="settings-toggle">
            <label className="field__label" htmlFor={`settings-channel-${channel}`}>
              {t(`notifications.channel.${channel}`)}
            </label>
            <input
              id={`settings-channel-${channel}`}
              type="checkbox"
              role="switch"
              className="settings-toggle__control"
              data-testid={`settings-channel-${channel}-toggle`}
              checked={channels[channel]}
              aria-checked={channels[channel]}
              disabled={!supported}
              aria-describedby={`settings-channel-${channel}-description`}
              onChange={(event) => setChannel(channel, event.target.checked)}
            />
          </div>
          <p className="field__description" id={`settings-channel-${channel}-description`}>
            {t(`notifications.channelDescription.${channel}`)}
          </p>
        </div>
      ))}
      <div className="field">
        <div className="settings-toggle">
          <label className="field__label" htmlFor="settings-stay-connected">
            {t('notifications.stayConnected')}
          </label>
          <input
            id="settings-stay-connected"
            type="checkbox"
            role="switch"
            className="settings-toggle__control"
            data-testid="settings-stay-connected-toggle"
            checked={stayConnected}
            aria-checked={stayConnected}
            disabled={!stayConnectedSupported}
            aria-describedby="settings-stay-connected-description"
            onChange={(event) => setStayConnected(event.target.checked)}
          />
        </div>
        <p className="field__description" id="settings-stay-connected-description">
          {t('notifications.stayConnectedDescription')}
        </p>
        {stayConnectedSupported ? null : (
          <p className="field__description" data-testid="settings-stay-connected-unavailable">
            {t('notifications.stayConnectedUnavailable')}
          </p>
        )}
      </div>
      <PushSection />
      <NavLink
        to="/settings/notifications/battery"
        className="settings-row"
        data-testid="settings-battery-guidance"
      >
        <span>{t('notifications.batteryGuidance')}</span>
        <ChevronRightIcon className="settings-row__chevron" />
      </NavLink>
      <ConfirmDialog
        open={rationaleOpen}
        title={t('notifications.rationale.title')}
        message={t('notifications.rationale.message')}
        confirmLabel={t('notifications.rationale.confirm')}
        onConfirm={() => void confirmRationale()}
        onCancel={() => setRationaleOpen(false)}
        testId="notifications-rationale"
      />
    </section>
  );
}
