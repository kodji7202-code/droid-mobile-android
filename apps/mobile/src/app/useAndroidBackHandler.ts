import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { isCameraScanActive } from '../platform/qrScanner';

/**
 * Android hardware/system back button handling for native builds: navigate
 * back through the in-app history, or exit the app when already at a root
 * destination. Web builds never receive the Capacitor backButton event (the
 * browser back button works natively), so the hook is a no-op there.
 */
export function useAndroidBackHandler(
  navigateBack: (delta: number) => void,
  isAtRoot: boolean,
): void {
  const isAtRootRef = useRef(isAtRoot);

  useEffect(() => {
    isAtRootRef.current = isAtRoot;
  }, [isAtRoot]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return undefined;
    }
    let cancelled = false;
    let listener: { remove(): void } | undefined;
    void App.addListener('backButton', () => {
      if (isCameraScanActive()) return;
      if (isAtRootRef.current) {
        void App.exitApp();
      } else {
        navigateBack(-1);
      }
    }).then((registered) => {
      if (cancelled) {
        void registered.remove();
        return;
      }
      listener = registered;
    });
    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [navigateBack]);
}
