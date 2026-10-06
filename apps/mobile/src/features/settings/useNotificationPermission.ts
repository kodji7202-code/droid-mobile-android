import { useCallback, useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import type { AppNotificationsApi } from '../../platform/appNotifications';

/**
 * Whether Android currently lets the app show notifications (null until known). It is read
 * again whenever the user comes back, because the permission can change in system settings.
 */
export function useNotificationPermission(api: AppNotificationsApi) {
  const [granted, setGranted] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!api.isSupported()) return null;
    const value = await api.permissionGranted();
    setGranted(value);
    return value;
  }, [api]);

  useEffect(() => {
    if (!api.isSupported()) return undefined;
    void refresh();
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    const resume = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void resume.then((listener) => listener.remove());
    };
  }, [api, refresh]);

  return { granted, setGranted, refresh };
}
