import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAuthPage } from './openAuthPage';

const open = vi.hoisted(() => vi.fn(async (_options: { url: string }) => {}));
vi.mock('@capacitor/browser', () => ({ Browser: { open } }));

afterEach(() => {
  vi.restoreAllMocks();
  open.mockClear();
});

describe('openAuthPage', () => {
  it('opens an https page in the Custom Tab on Android', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    await expect(openAuthPage('https://mcp.linear.app/authorize?state=x')).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith({ url: 'https://mcp.linear.app/authorize?state=x' });
  });

  it('never opens anything on the web', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    await expect(openAuthPage('https://mcp.linear.app/authorize')).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['javascript:alert(1)', 'intent://x#Intent;end', 'file:///etc/hosts', 'not a url'])(
    'refuses %s on Android',
    async (url) => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      await expect(openAuthPage(url)).resolves.toBe(false);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('reports false when the plugin fails so the panel button stays the fallback', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    open.mockRejectedValueOnce(new Error('no browser'));
    await expect(openAuthPage('https://mcp.linear.app/authorize')).resolves.toBe(false);
  });
});
