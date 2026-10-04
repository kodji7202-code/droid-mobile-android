import type { CapacitorConfig } from '@capacitor/cli';

export type CapacitorVariant = 'debug' | 'release';

/**
 * Transport policy (architecture.md section 2): debug builds load the web app over
 * plain http so `ws://` daemons are reachable (adb reverse / 10.0.2.2), while release
 * keeps the default https://localhost origin and is wss-only.
 *
 * The variant is selected by the CAPACITOR_VARIANT environment variable at
 * `cap sync` time (see tools/dev/build-android.ps1) — never by hand-editing the
 * generated android/ files. Unset or unknown values fail secure to release.
 */
export function buildConfig(variant: CapacitorVariant): CapacitorConfig {
  const base: CapacitorConfig = {
    appId: 'com.droidmobile.client',
    appName: 'Droid Mobile',
    webDir: 'dist',
  };
  if (variant === 'debug') {
    return {
      ...base,
      // http scheme so ws:// daemons are reachable from the WebView (debug only).
      server: { androidScheme: 'http' },
      android: {
        // DevTools socket for validator CDP access (debug APK only).
        webContentsDebuggingEnabled: true,
      },
    };
  }
  return {
    ...base,
    // https://localhost (Capacitor default, explicit here for the automated checks).
    server: { androidScheme: 'https' },
    android: {
      webContentsDebuggingEnabled: false,
    },
  };
}

function variantFromEnv(): CapacitorVariant {
  return process.env.CAPACITOR_VARIANT === 'debug' ? 'debug' : 'release';
}

const config: CapacitorConfig = buildConfig(variantFromEnv());
export default config;
