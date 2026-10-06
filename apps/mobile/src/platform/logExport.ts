import { Capacitor } from '@capacitor/core';

export type LogExportResult =
  { kind: 'downloaded' } | { kind: 'shared'; uri: string } | { kind: 'saved'; uri: string };

interface NativeExport {
  writeFile(options: {
    path: string;
    data: string;
    directory: 'CACHE';
    encoding: 'utf8';
  }): Promise<{ uri: string }>;
  share(options: { title: string; files: string[]; dialogTitle: string }): Promise<unknown>;
}

interface ExportDeps {
  isNative?: () => boolean;
  native?: () => Promise<NativeExport>;
}

/** Plugins load on demand so the Android-only code stays out of the main chunk. */
async function loadNative(): Promise<NativeExport> {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  return {
    writeFile: (options) =>
      Filesystem.writeFile({
        path: options.path,
        data: options.data,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      }),
    share: (options) => Share.share(options),
  };
}

/**
 * Chromium reads a blob download after click() returns. Revoking the object
 * URL in the same task cancels it (the file ends up empty or never appears),
 * so the URL is released only after the browser had ample time to start it.
 */
const REVOKE_DELAY_MS = 60_000;

function downloadInBrowser(text: string, fileName: string): void {
  if (text.length === 0) throw new Error('Nothing to export');
  const anchor = document.createElement('a');
  if (!('download' in anchor)) throw new Error('This browser cannot download files');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    anchor.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Hands a text file to the user. The browser downloads it. Android writes it to
 * the app cache and opens the share sheet; if the sheet fails or is dismissed
 * the file stays in the cache, so the result says `saved` instead of `shared`.
 */
export async function exportLogFile(
  text: string,
  fileName: string,
  deps: ExportDeps = {},
): Promise<LogExportResult> {
  const isNative = deps.isNative ?? (() => Capacitor.isNativePlatform());
  if (!isNative()) {
    downloadInBrowser(text, fileName);
    return { kind: 'downloaded' };
  }
  const native = await (deps.native ?? loadNative)();
  const { uri } = await native.writeFile({
    path: fileName,
    data: text,
    directory: 'CACHE',
    encoding: 'utf8',
  });
  try {
    await native.share({ title: fileName, files: [uri], dialogTitle: fileName });
    return { kind: 'shared', uri };
  } catch {
    return { kind: 'saved', uri };
  }
}
