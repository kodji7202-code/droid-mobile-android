/**
 * Opens an http(s) page outside the app. In the Android WebView the new-window
 * request is routed by the Capacitor bridge to an ACTION_VIEW intent for
 * external hosts, so the app WebView stays where it is.
 */
export function openExternal(url: string): boolean {
  let protocol: string;
  try {
    ({ protocol } = new URL(url));
  } catch {
    return false;
  }
  if (protocol !== 'https:' && protocol !== 'http:') return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
