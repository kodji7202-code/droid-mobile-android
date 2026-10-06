const FALLBACK_LABEL = 'Android device';
const MAX_LENGTH = 64;

interface UserAgentDataLike {
  getHighEntropyValues?(hints: string[]): Promise<{ model?: unknown }>;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
}

/** A reduced user agent reports the model as a bare "K"; that is not a usable label. */
function usable(model: string): boolean {
  return model.length > 1 && model !== 'Build';
}

/**
 * Human-readable name of this phone for the bridge's device list. The WebView hides the model
 * from the user agent string, so the high-entropy client hint is asked first.
 */
export async function deviceLabel(
  nav: {
    userAgent?: string;
    userAgentData?: UserAgentDataLike;
  } = typeof navigator === 'undefined' ? {} : (navigator as typeof nav),
): Promise<string> {
  try {
    const values = await nav.userAgentData?.getHighEntropyValues?.(['model']);
    if (typeof values?.model === 'string' && usable(clean(values.model))) {
      return clean(values.model);
    }
  } catch {
    // Falls back to the user agent string.
  }
  const match = /Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/.exec(nav.userAgent ?? '');
  const fromAgent = match?.[1] ? clean(match[1]) : '';
  return usable(fromAgent) ? fromAgent : FALLBACK_LABEL;
}
