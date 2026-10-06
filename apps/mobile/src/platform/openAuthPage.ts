import { Capacitor } from '@capacitor/core';

/**
 * Opens an OAuth authorization page in a Custom Tab on Android, where the call
 * has to work without a user gesture because the URL only arrives from polling
 * the daemon. The web build never opens it automatically (a popup outside a
 * click is blocked); the sign-in panel offers an explicit button there.
 * Resolves to whether a tab was opened.
 */
export async function openAuthPage(url: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  let protocol: string;
  try {
    ({ protocol } = new URL(url));
  } catch {
    return false;
  }
  if (protocol !== 'https:' && protocol !== 'http:') return false;
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
    return true;
  } catch {
    return false;
  }
}
