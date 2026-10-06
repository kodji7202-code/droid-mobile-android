import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/** Texts of the persistent service notification, in the app language. */
export interface ServiceTexts {
  title: string;
  text: string;
  stopLabel: string;
}

interface DaemonServicePlugin {
  start(texts: ServiceTexts): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<{ running: boolean }>;
  consumeStopRequest(): Promise<{ requested: boolean }>;
  getBatteryState(): Promise<{ exempt: boolean }>;
  openBatterySettings(): Promise<void>;
  addListener(
    event: 'serviceStopped' | 'serviceTimedOut',
    listener: () => void,
  ): Promise<PluginListenerHandle>;
}

export type BatteryState = 'exempt' | 'notExempt' | 'unknown';

/** Native foreground service that keeps the process (and the daemon socket) alive. */
export interface DaemonServiceApi {
  /** True on the Android app; the web build has no service. */
  isSupported(): boolean;
  /** Starts the service or refreshes its notification texts; false when Android refused. */
  start(texts: ServiceTexts): Promise<boolean>;
  stop(): Promise<void>;
  /** True once if the user pressed Stop in the notification since the last call. */
  consumeStopRequest(): Promise<boolean>;
  batteryState(): Promise<BatteryState>;
  openBatterySettings(): Promise<boolean>;
  /** Calls back when the service ended without the app asking (Stop action, Android timeout). */
  onEnded(listener: () => void): () => void;
}

export function createDaemonService(
  plugin: DaemonServicePlugin = registerPlugin<DaemonServicePlugin>('DaemonService'),
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): DaemonServiceApi {
  return {
    isSupported: isNative,
    async start(texts) {
      if (!isNative()) return false;
      try {
        await plugin.start(texts);
        return true;
      } catch {
        return false;
      }
    },
    async stop() {
      if (!isNative()) return;
      try {
        await plugin.stop();
      } catch {
        // Nothing to stop.
      }
    },
    async consumeStopRequest() {
      if (!isNative()) return false;
      try {
        return (await plugin.consumeStopRequest()).requested;
      } catch {
        return false;
      }
    },
    async batteryState() {
      if (!isNative()) return 'unknown';
      try {
        return (await plugin.getBatteryState()).exempt ? 'exempt' : 'notExempt';
      } catch {
        return 'unknown';
      }
    },
    async openBatterySettings() {
      if (!isNative()) return false;
      try {
        await plugin.openBatterySettings();
        return true;
      } catch {
        return false;
      }
    },
    onEnded(listener) {
      if (!isNative()) return () => undefined;
      const handles = [
        plugin.addListener('serviceStopped', listener),
        plugin.addListener('serviceTimedOut', listener),
      ];
      return () => {
        for (const handle of handles) void handle.then((item) => item.remove());
      };
    },
  };
}

export const daemonService = createDaemonService();
