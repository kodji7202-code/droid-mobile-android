import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { FilePicker } from '@capawesome/capacitor-file-picker';

export type QrScanResult =
  | { status: 'ok'; text: string }
  | { status: 'none' }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'error' };

export interface QrScannerApi {
  /** True when a native scanner exists (Android app). */
  isSupported(): boolean;
  /** Live camera scan; asks for the camera permission first. */
  scanCamera(onPreview?: () => void): Promise<QrScanResult>;
  /** Ends a running camera scan; the pending scanCamera() resolves as cancelled. */
  stopCamera(): Promise<void>;
  /** Picks an image and decodes a QR code from it. */
  scanImage(): Promise<QrScanResult>;
}

interface Barcodes {
  barcodes: { rawValue: string }[];
}

interface ScannerPlugin {
  requestPermissions: () => Promise<{ camera: string }>;
  startScan: (options: { formats: BarcodeFormat[] }) => Promise<void>;
  stopScan: () => Promise<void>;
  addListener: (
    event: 'barcodesScanned',
    listener: (event: Barcodes) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
  readBarcodesFromImage: (options: { path: string; formats: BarcodeFormat[] }) => Promise<Barcodes>;
}

interface PickerPlugin {
  pickFiles: (options: {
    types: string[];
    limit: number;
  }) => Promise<{ files: { path?: string }[] }>;
}

interface BackButtonSource {
  addListener: (
    event: 'backButton',
    listener: () => void,
  ) => Promise<{ remove: () => Promise<void> }>;
}

const FORMATS = [BarcodeFormat.QrCode];
// The camera is drawn behind the WebView; this body class lets the stylesheet make the page transparent.
const ACTIVE_CLASS = 'barcode-scanner-active';

let cameraActive = false;

/**
 * True while the camera preview is up and for one tick after it closes, so the
 * app-level back handler does not also exit the app on the press that closed it.
 */
export function isCameraScanActive(): boolean {
  return cameraActive;
}

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

function firstText(barcodes: { rawValue: string }[]): QrScanResult {
  const text = barcodes.find((barcode) => barcode.rawValue.trim() !== '')?.rawValue;
  return text === undefined ? { status: 'none' } : { status: 'ok', text };
}

export function createQrScanner(
  scanner: ScannerPlugin = BarcodeScanner as unknown as ScannerPlugin,
  picker: PickerPlugin = FilePicker as unknown as PickerPlugin,
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
  backButton: BackButtonSource = App as unknown as BackButtonSource,
): QrScannerApi {
  let finishScan: ((result: QrScanResult) => void) | null = null;

  const stopCamera = async () => {
    finishScan?.({ status: 'cancelled' });
  };

  return {
    isSupported: isNative,
    stopCamera,
    async scanCamera(onPreview) {
      if (!isNative()) return { status: 'unavailable' };
      if (finishScan) return { status: 'cancelled' };
      let scanListener: { remove: () => Promise<void> } | undefined;
      let backListener: { remove: () => Promise<void> } | undefined;
      try {
        const permission = await scanner.requestPermissions();
        if (permission.camera !== 'granted' && permission.camera !== 'limited') {
          return { status: 'denied' };
        }
        const result = await new Promise<QrScanResult>((resolve, reject) => {
          finishScan = resolve;
          onPreview?.();
          cameraActive = true;
          document.body.classList.add(ACTIVE_CLASS);
          void (async () => {
            try {
              scanListener = await scanner.addListener('barcodesScanned', (event) => {
                const found = firstText(event.barcodes);
                if (found.status === 'ok') resolve(found);
              });
              backListener = await backButton.addListener('backButton', () => {
                resolve({ status: 'cancelled' });
              });
              await scanner.startScan({ formats: FORMATS });
            } catch (error) {
              reject(error);
            }
          })();
        });
        return result;
      } catch (error) {
        return isCancel(error) ? { status: 'cancelled' } : { status: 'error' };
      } finally {
        finishScan = null;
        document.body.classList.remove(ACTIVE_CLASS);
        await scanListener?.remove().catch(() => undefined);
        await backListener?.remove().catch(() => undefined);
        await scanner.stopScan().catch(() => undefined);
        setTimeout(() => {
          cameraActive = false;
        }, 0);
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
