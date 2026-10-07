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

function pushConfig(api: AppNotificationsApi, t: Translate): Promise<void> {
  const settings = useNotificationSettingsStore.getState();
  return api.configure({
    channelNames: {
      approvals: t('notifications.channel.approvals'),
      turns: t('notifications.channel.turns'),
      service: t('notifications.channel.service'),
    },
    enabled: settings.enabled,
    approvals: settings.approvals,
    turns: settings.turns,
  });
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
  // The latest channel setup sent to the native side; a post waits for it so Android never
  // judges a notification against switches or names that the user has already changed.
  const configuredRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!api.isSupported()) return;
    configuredRef.current = pushConfig(api, translateRef.current);
  }, [api, t]);

  useEffect(() => {
    if (!api.isSupported()) return undefined;
    const gated: Pick<AppNotificationsApi, 'post' | 'cancel'> = {
      post: async (notification) => {
        await configuredRef.current;
        return api.post(notification);
      },
      cancel: (tag) => api.cancel(tag),
    };
    const coordinator = new NotificationCoordinator(gated, () => translateRef.current);
    const run = () => coordinator.update(snapshot());
    run();
    const stops = [
      useSessionViewStore.subscribe(run),
      useInteractionStore.subscribe(run),
      useForegroundStore.subscribe(run),
      useNotificationSettingsStore.subscribe(() => {
        configuredRef.current = pushConfig(api, translateRef.current);
        run();
      }),
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
}
