import { Capacitor } from '@capacitor/core';

/**
 * Android WebView denies `navigator.clipboard.readText()` (no clipboard-read
 * permission prompt), so the native app goes through the Capacitor plugin,
 * which is imported lazily to stay out of the main chunk.
 */
async function nativeClipboard() {
  const { Clipboard } = await import('@capacitor/clipboard');
  // Wrapped because resolving a promise with the plugin proxy itself calls its unimplemented 	hen.
  return { plugin: Clipboard };
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (Capacitor.isNativePlatform()) {
      await (await nativeClipboard()).plugin.write({ string: text });
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch {
    return legacyCopy(text);
  }
}

export async function readClipboardText(): Promise<string | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { value } = await (await nativeClipboard()).plugin.read();
      return value;
    }
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } finally {
    area.remove();
  }
}
