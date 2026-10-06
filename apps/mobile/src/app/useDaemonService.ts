import { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { daemonService } from '../platform/daemonService';
import type { DaemonServiceApi } from '../platform/daemonService';
import { ServiceSync } from '../platform/serviceSync';
import { useInteractionStore } from '../stores/interactions';
import { useSessionViewStore } from '../stores/sessionView';
import { useStayConnectedStore } from '../stores/stayConnected';

/**
 * Keeps the Android foreground service in step with the app: running while any turn is
 * pending or running, while a request waits for the user, or while "stay connected" is on.
 * A Stop tap in the notification switches "stay connected" off and is never undone.
 */
export function useDaemonService(service: DaemonServiceApi = daemonService): void {
  const { t } = useTranslation();
  const stayConnected = useStayConnectedStore((state) => state.enabled);
  const turnActive = useSessionViewStore((state) =>
    Object.values(state.views).some((view) => view.turnActive),
  );
  const requestPending = useInteractionStore((state) => state.pending.length > 0);
  const [stopApplied, setStopApplied] = useState(!service.isSupported());
  const syncRef = useRef<ServiceSync | null>(null);
  syncRef.current ??= new ServiceSync(service);

  useEffect(() => {
    if (!service.isSupported()) return undefined;
    const applyStopRequest = async () => {
      if (await service.consumeStopRequest()) useStayConnectedStore.getState().setEnabled(false);
    };
    void applyStopRequest().finally(() => setStopApplied(true));
    const stopListening = service.onEnded(() => {
      syncRef.current?.ended();
      void applyStopRequest();
    });
    const resume = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void applyStopRequest();
    });
    return () => {
      stopListening();
      void resume.then((listener) => listener.remove());
      syncRef.current?.dispose();
    };
  }, [service]);

  const title = t('service.notificationTitle');
  const text = t('service.notificationText');
  const stopLabel = t('service.stopLabel');
  useEffect(() => {
    // Wait for the stored Stop request: a service stopped from the notification must not come back.
    if (!stopApplied) return;
    syncRef.current?.update(
      { stayConnected, turnActive, requestPending },
      { title, text, stopLabel },
    );
  }, [stopApplied, stayConnected, turnActive, requestPending, title, text, stopLabel]);
}
