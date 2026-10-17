import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { usePairLinkStore } from './pairLinkStore';

/**
 * Feeds `droidmobile://` deliveries into the pair-link store: the launch URL on a cold
 * start and `appUrlOpen` while the app is running. Nothing here logs or stores the URI;
 * the store decides what is a pairing link.
 */
export function usePairLinkListeners(): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const receive = (uri: string | undefined) => {
      if (uri) usePairLinkStore.getState().receive(uri);
    };
    const handle = CapacitorApp.addListener('appUrlOpen', ({ url }) => receive(url));
    CapacitorApp.getLaunchUrl()
      .then((launch) => receive(launch?.url))
      .catch(() => undefined);
    return () => {
      void handle.then((listener) => listener.remove());
    };
  }, []);
}
