import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportLogFile } from './logExport';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('exportLogFile on the web', () => {
  it('downloads the text as a named file and revokes the object URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const result = await exportLogFile('hello', 'logs.txt', { isNative: () => false });

    expect(result).toEqual({ kind: 'downloaded' });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(blob.size).toBe(5);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

describe('exportLogFile on Android', () => {
  it('writes the file to the app cache and opens the share sheet with it', async () => {
    const writeFile = vi.fn(async () => ({ uri: 'file:///cache/logs.txt' }));
    const share = vi.fn(async () => ({ activityType: 'x' }));
    const result = await exportLogFile('hello', 'logs.txt', {
      isNative: () => true,
      native: async () => ({ writeFile, share }),
    });
    expect(writeFile).toHaveBeenCalledWith({
      path: 'logs.txt',
      data: 'hello',
      directory: 'CACHE',
      encoding: 'utf8',
    });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///cache/logs.txt'] }),
    );
    expect(result).toEqual({ kind: 'shared', uri: 'file:///cache/logs.txt' });
  });

  it('still reports the saved file when the share sheet is dismissed or unavailable', async () => {
    const writeFile = vi.fn(async () => ({ uri: 'file:///cache/logs.txt' }));
    const share = vi.fn(async () => {
      throw new Error('Share canceled');
    });
    const result = await exportLogFile('hello', 'logs.txt', {
      isNative: () => true,
      native: async () => ({ writeFile, share }),
    });
    expect(result).toEqual({ kind: 'saved', uri: 'file:///cache/logs.txt' });
  });

  it('rejects when the file cannot be written', async () => {
    const writeFile = vi.fn(async () => {
      throw new Error('disk full');
    });
    await expect(
      exportLogFile('hello', 'logs.txt', {
        isNative: () => true,
        native: async () => ({ writeFile, share: vi.fn() }),
      }),
    ).rejects.toThrow('disk full');
  });
});
