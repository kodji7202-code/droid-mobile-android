import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { appNotificationsPlugin } from './appNotifications';
import type { AppNotificationsPlugin } from './appNotifications';

// Registered by name instead of importing the package entry: its web fallback pulls in the
// optional `firebase` web SDK, which the Android-only app does not ship.
interface FirebaseMessagingPlugin {
  getToken(): Promise<{ token: string }>;
  addListener(
    event: 'tokenReceived',
    listener: (data: { token: string }) => void,
  ): Promise<PluginListenerHandle>;
}

/** The device's FCM registration token. */
export interface PushMessagingApi {
  /** True on the Android app; the web build has no FCM. */
  isSupported(): boolean;
  /** The current token, or null when Firebase cannot produce one. */
  getToken(): Promise<string | null>;
  /** Invalidates the current token so no push reaches this phone; false when that failed. */
  deleteToken(): Promise<boolean>;
  /** Fires when FCM issues a new token (rotation, restore, deleteToken + getToken). */
  onTokenRefresh(listener: (token: string) => void): () => void;
}

export function createPushMessaging(
  plugin: FirebaseMessagingPlugin = registerPlugin<FirebaseMessagingPlugin>('FirebaseMessaging'),
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
  // The stock plugin's deleteToken resolves before Firebase finished, so deletion goes through the app's own plugin.
  tokenDeletion: Pick<AppNotificationsPlugin, 'deleteToken'> = {
    deleteToken: () => appNotificationsPlugin.deleteToken(),
  },
): PushMessagingApi {
  return {
    isSupported: isNative,
    async getToken() {
      if (!isNative()) return null;
      try {
        const { token } = await plugin.getToken();
        return typeof token === 'string' && token !== '' ? token : null;
      } catch {
        return null;
      }
    },
    async deleteToken() {
      if (!isNative()) return false;
      try {
        await tokenDeletion.deleteToken();
        return true;
      } catch {
        return false;
      }
    },
    onTokenRefresh(listener) {
      if (!isNative()) return () => undefined;
      const handle = plugin.addListener('tokenReceived', ({ token }) => {
        if (typeof token === 'string' && token !== '') listener(token);
      });
      return () => void handle.then((item) => item.remove());
    },
  };
}

export const pushMessaging: PushMessagingApi = createPushMessaging();
