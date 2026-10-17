import { Capacitor } from '@capacitor/core';
import {
  BarcodeFormat,
  BarcodeScanner,
  GoogleBarcodeScannerModuleInstallState,
} from '@capacitor-mlkit/barcode-scanning';
import type { GoogleBarcodeScannerModuleInstallProgressEvent } from '@capacitor-mlkit/barcode-scanning';
import { FilePicker } from '@capawesome/capacitor-file-picker';

export type QrScanResult =
  | { status: 'ok'; text: string }
  | { status: 'none' }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'moduleUnavailable' }
  | { status: 'error' };

export interface QrScannerApi {
  /** True when a native scanner exists (Android app). */
  isSupported(): boolean;
  /**
   * Scans with the Google Code Scanner (no camera permission, its own screen).
   * Installs the Google module first when it is missing and reports the download
   * percentage through `onInstallProgress`.
   */
  scanCamera(onInstallProgress?: (percent: number) => void): Promise<QrScanResult>;
  /** Picks an image and decodes a QR code from it. */
  scanImage(): Promise<QrScanResult>;
}

interface Barcodes {
  barcodes: { rawValue?: string }[];
}

interface ScannerPlugin {
  scan: (options: { formats: BarcodeFormat[] }) => Promise<Barcodes>;
  isGoogleBarcodeScannerModuleAvailable: () => Promise<{ available: boolean }>;
  installGoogleBarcodeScannerModule: () => Promise<void>;
  addListener: (
    event: 'googleBarcodeScannerModuleInstallProgress',
    listener: (event: GoogleBarcodeScannerModuleInstallProgressEvent) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
  readBarcodesFromImage: (options: { path: string; formats: BarcodeFormat[] }) => Promise<Barcodes>;
}

interface PickerPlugin {
  pickFiles: (options: {
    types: string[];
    limit: number;
  }) => Promise<{ files: { path?: string }[] }>;
}

const FORMATS = [BarcodeFormat.QrCode];

function errorText(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message.toLowerCase() : '';
}

function isCancel(error: unknown): boolean {
  return errorText(error).includes('cancel');
}

function toUri(path: string): string {
  return path.startsWith('/') ? `file://${path}` : path;
}

function hasText(barcode: { rawValue?: unknown }): barcode is { rawValue: string } {
  return typeof barcode.rawValue === 'string' && barcode.rawValue.trim() !== '';
}

function firstText(barcodes: { rawValue?: unknown }[]): QrScanResult {
  const text = barcodes.find(hasText)?.rawValue;
  return text === undefined ? { status: 'none' } : { status: 'ok', text };
}

/** Resolves true once the Google module is installed, false when the download fails or is cancelled. */
async function installModule(
  scanner: ScannerPlugin,
  onProgress: ((percent: number) => void) | undefined,
): Promise<boolean> {
  let settle: (installed: boolean) => void = () => undefined;
  const finished = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  // Subscribed before the install starts so a fast COMPLETED event cannot be missed.
  const listener = await scanner.addListener(
    'googleBarcodeScannerModuleInstallProgress',
    (event) => {
      if (event.state === GoogleBarcodeScannerModuleInstallState.COMPLETED) {
        settle(true);
      } else if (
        event.state === GoogleBarcodeScannerModuleInstallState.FAILED ||
        event.state === GoogleBarcodeScannerModuleInstallState.CANCELED
      ) {
        settle(false);
      } else {
        onProgress?.(Math.min(100, Math.max(0, Math.round(event.progress ?? 0))));
      }
    },
  );
  try {
    onProgress?.(0);
    await scanner.installGoogleBarcodeScannerModule();
    return await finished;
  } catch (error) {
    // The module landed between the availability check and the install request.
    return errorText(error).includes('already installed');
  } finally {
    await listener.remove().catch(() => undefined);
  }
}

export function createQrScanner(
  scanner: ScannerPlugin = BarcodeScanner as unknown as ScannerPlugin,
  picker: PickerPlugin = FilePicker as unknown as PickerPlugin,
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): QrScannerApi {
  // Claimed synchronously so a second tap cannot overlap an install or a scan.
  let scanning = false;

  return {
    isSupported: isNative,
    async scanCamera(onInstallProgress) {
      if (!isNative()) return { status: 'unavailable' };
      if (scanning) return { status: 'cancelled' };
      scanning = true;
      try {
        const { available } = await scanner.isGoogleBarcodeScannerModuleAvailable();
        if (!available && !(await installModule(scanner, onInstallProgress))) {
          return { status: 'moduleUnavailable' };
        }
        const result = await scanner.scan({ formats: FORMATS });
        // An empty result is how the scanner reports a dismissed screen.
        return result.barcodes.length === 0 ? { status: 'cancelled' } : firstText(result.barcodes);
      } catch (error) {
        if (isCancel(error)) return { status: 'cancelled' };
        return errorText(error).includes('not available')
          ? { status: 'moduleUnavailable' }
          : { status: 'error' };
      } finally {
        scanning = false;
      }
    },
    async scanImage() {
      if (!isNative()) return { status: 'unavailable' };
      let path: string | undefined;
      try {
        const picked = await picker.pickFiles({ types: ['image/*'], limit: 1 });
        path = picked.files[0]?.path;
      } catch (error) {
        return isCancel(error) ? { status: 'cancelled' } : { status: 'error' };
      }
      if (path === undefined) return { status: 'cancelled' };
      try {
        const result = await scanner.readBarcodesFromImage({
          path: toUri(path),
          formats: FORMATS,
        });
        return firstText(result.barcodes);
      } catch {
        // An undecodable image is the same outcome for the user as an image without a code.
        return { status: 'none' };
      }
    },
  };
}

export const qrScanner: QrScannerApi = createQrScanner();
