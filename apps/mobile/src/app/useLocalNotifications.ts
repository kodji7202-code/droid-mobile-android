import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { appNotifications } from '../platform/appNotifications';
import type { AppNotificationsApi } from '../platform/appNotifications';
import { useForegroundStore } from '../stores/foreground';
import { useInteractionStore } from '../stores/interactions';
import { useNotificationSettingsStore } from '../stores/notificationSettings';
import { useSessionViewStore } from '../stores/sessionView';
import { NotificationCoordinator } from './notificationCoordinator';
import type { NotificationSnapshot, Translate } from './notificationCoordinator';

type Navigate = (to: string) => unknown;

function snapshot(): NotificationSnapshot {
  const settings = useNotificationSettingsStore.getState();
  const foreground = useForegroundStore.getState();
  return {
    enabled: settings.enabled,
    approvals: settings.approvals,
    turns: settings.turns,
    appActive: foreground.appActive,
    viewedSessionId: foreground.viewedSessionId,
    pending: useInteractionStore.getState().pending,
    views: useSessionViewStore.getState().views,
  };
}

/**
 * Wires the Android notifications: channel names and switches follow the settings and the
 * app language, requests and finished turns are posted while the user is elsewhere, a tap
 * opens the session, and the Approve button answers the request.
 */
export function useLocalNotifications(
  navigate: Navigate,
  api: AppNotificationsApi = appNotifications,
): void {
  const { t } = useTranslation();
  const translateRef = useRef<Translate>(t as Translate);
  translateRef.current = t as Translate;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const enabled = useNotificationSettingsStore((state) => state.enabled);
  const approvals = useNotificationSettingsStore((state) => state.approvals);
  const turns = useNotificationSettingsStore((state) => state.turns);

  useEffect(() => {
    if (!api.isSupported()) return undefined;
    const coordinator = new NotificationCoordinator(api, () => translateRef.current);
    const run = () => coordinator.update(snapshot());
    run();
    const stops = [
      useSessionViewStore.subscribe(run),
      useInteractionStore.subscribe(run),
      useForegroundStore.subscribe(run),
      useNotificationSettingsStore.subscribe(run),
      api.onTap((sessionId) => navigateRef.current(`/sessions/${sessionId}`)),
      api.onApprove((requestId, sessionId) => {
        const store = useInteractionStore.getState();
        const entry = store.pending.find((item) => item.id === requestId);
        if (entry?.kind !== 'permission') return;
        store.answerPermission(requestId, 'once');
        void useSessionViewStore.getState().follow(sessionId || entry.sessionId);
      }),
    ];
    const state = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      useForegroundStore.getState().setAppActive(isActive);
    });
    void CapacitorApp.getState().then(({ isActive }) =>
      useForegroundStore.getState().setAppActive(isActive),
    );
    return () => {
      for (const stop of stops) stop();
      void state.then((listener) => listener.remove());
    };
  }, [api]);

  useEffect(() => {
    if (!api.isSupported()) return;
    void api.configure({
      channelNames: {
        approvals: t('notifications.channel.approvals'),
        turns: t('notifications.channel.turns'),
        service: t('notifications.channel.service'),
      },
      enabled,
      approvals,
      turns,
    });
  }, [api, t, enabled, approvals, turns]);
}
