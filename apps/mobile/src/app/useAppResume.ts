import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useConnectionStore } from '../stores/connection';
import { useSessionViewStore } from '../stores/sessionView';

/** What to do when the app returns to the foreground. */
export function resumeApp(): void {
  const { status, retry } = useConnectionStore.getState();
  if (status === 'ready') void useSessionViewStore.getState().refreshOnResume();
  else retry();
}

/**
 * The socket lives in the WebView and can drop while the app is in the background.
 * On foreground, reconnect if it did, otherwise re-read the history of open sessions.
 */
export function useAppResume(): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) resumeApp();
    });
    return () => {
      void handle.then((listener) => listener.remove());
    };
  }, []);
}
