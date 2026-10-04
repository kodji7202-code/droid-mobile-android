import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useLockStore } from '../../stores/lock';
import { LockScreen } from './LockScreen';

/**
 * Renders the lock screen in place of the app while locked, and re-locks when
 * the app returns from the background after the configured grace period.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const locked = useLockStore((state) => state.locked);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      const store = useLockStore.getState();
      if (isActive) store.onForeground(Date.now());
      else store.onBackground(Date.now());
    });
    return () => {
      void handle.then((listener) => listener.remove());
    };
  }, []);

  return locked ? <LockScreen /> : <>{children}</>;
}
