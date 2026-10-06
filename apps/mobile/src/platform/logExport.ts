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

function downloadInBrowser(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
