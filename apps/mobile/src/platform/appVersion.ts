import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { version } from '../../package.json';

/**
 * App version of the web bundle (VAL-ONBOARD-035, VAL-SET-021). The value comes
 * from apps/mobile/package.json, which Gradle also uses for the APK versionName.
 */
export const APP_VERSION: string = version;

/**
 * The version of the installed app: the APK versionName on Android (what the
 * system reports), the bundle version elsewhere (VAL-SET-022).
 */
export async function readInstalledAppVersion(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return APP_VERSION;
  try {
    return (await App.getInfo()).version;
  } catch {
    return APP_VERSION;
  }
}

export function useInstalledAppVersion(): string {
  const [installed, setInstalled] = useState(APP_VERSION);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let cancelled = false;
    void readInstalledAppVersion().then((value) => {
      if (!cancelled) setInstalled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return installed;
}
