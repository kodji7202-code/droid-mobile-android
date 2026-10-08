import { afterEach, describe, expect, it, vi } from 'vitest';

// The setup file already imported the module graph; load a fresh copy so the
// module-level startup code runs against the storage state set up here.
async function startup(): Promise<void> {
  vi.resetModules();
  const mod = await import('./init');
  await mod.i18nReady;
}

describe('document language at startup', () => {
  afterEach(() => {
    window.localStorage.removeItem('droidm.lang');
    document.documentElement.lang = 'en';
  });

  it('uses the stored Romanian language', async () => {
    window.localStorage.setItem('droidm.lang', 'ro');
    document.documentElement.lang = 'en';
    await startup();
    expect(document.documentElement.lang).toBe('ro');
  });

  it('defaults to English when nothing is stored', async () => {
    window.localStorage.removeItem('droidm.lang');
    document.documentElement.lang = 'ro';
    await startup();
    expect(document.documentElement.lang).toBe('en');
  });
});
