import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export type NotificationChannelId = 'approvals' | 'turns' | 'service';

export interface ChannelConfig {
  channelNames: Record<NotificationChannelId, string>;
  /** The user's master switch and the two per-channel switches. */
  enabled: boolean;
  approvals: boolean;
  turns: boolean;
}

export interface LocalNotification {
  /** One notification per tag; posting the same tag again replaces it. */
  tag: string;
  channel: 'approvals' | 'turns';
  title: string;
  text: string;
  /** Session opened when the notification is tapped. */
  sessionId: string;
  /** Adds an Approve button that reports this request id back. */
  approveRequestId?: string;
  approveLabel?: string;
}

interface AppNotificationsPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  openSettings(): Promise<void>;
  configure(config: ChannelConfig): Promise<void>;
  post(notification: LocalNotification): Promise<{ posted: boolean }>;
  cancel(options: { tag: string }): Promise<void>;
  addListener(
    event: 'notificationTapped',
    listener: (data: { sessionId: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'notificationApproved',
    listener: (data: { requestId: string; sessionId: string }) => void,
  ): Promise<PluginListenerHandle>;
}

/** Local notifications, their channels and the Android notification permission. */
export interface AppNotificationsApi {
  /** True on the Android app; the web build posts nothing. */
  isSupported(): boolean;
  /** Whether Android lets the app show notifications right now. */
  permissionGranted(): Promise<boolean>;
  /** Shows the system permission dialog (Android 13+) and reports the outcome. */
  requestPermission(): Promise<boolean>;
  openSettings(): Promise<boolean>;
  configure(config: ChannelConfig): Promise<void>;
  post(notification: LocalNotification): Promise<boolean>;
  cancel(tag: string): Promise<void>;
  onTap(listener: (sessionId: string) => void): () => void;
  onApprove(listener: (requestId: string, sessionId: string) => void): () => void;
}

export function createAppNotifications(
  plugin: AppNotificationsPlugin = registerPlugin<AppNotificationsPlugin>('AppNotifications'),
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): AppNotificationsApi {
  return {
    isSupported: isNative,
    async permissionGranted() {
      if (!isNative()) return false;
      try {
        return (await plugin.checkPermission()).granted;
      } catch {
        return false;
      }
    },
    async requestPermission() {
      if (!isNative()) return false;
      try {
        return (await plugin.requestPermission()).granted;
      } catch {
        return false;
      }
    },
    async openSettings() {
      if (!isNative()) return false;
      try {
        await plugin.openSettings();
        return true;
      } catch {
        return false;
      }
    },
    async configure(config) {
      if (!isNative()) return;
      try {
        await plugin.configure(config);
      } catch {
        // Channels are re-applied on the next change or launch.
      }
    },
    async post(notification) {
      if (!isNative()) return false;
      try {
        return (await plugin.post(notification)).posted;
      } catch {
        return false;
      }
    },
    async cancel(tag) {
      if (!isNative()) return;
      try {
        await plugin.cancel({ tag });
      } catch {
        // Nothing to cancel.
      }
    },
    onTap(listener) {
      if (!isNative()) return () => undefined;
      const handle = plugin.addListener('notificationTapped', (data) => listener(data.sessionId));
      return () => void handle.then((item) => item.remove());
    },
    onApprove(listener) {
      if (!isNative()) return () => undefined;
      const handle = plugin.addListener('notificationApproved', (data) =>
        listener(data.requestId, data.sessionId),
      );
      return () => void handle.then((item) => item.remove());
    },
  };
}

export const appNotifications = createAppNotifications();
