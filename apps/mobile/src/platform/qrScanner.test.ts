import { describe, expect, it, vi } from 'vitest';
import { GoogleBarcodeScannerModuleInstallState as State } from '@capacitor-mlkit/barcode-scanning';
import { createQrScanner } from './qrScanner';

type ProgressEvent = { state: number; progress?: number };

function make(overrides: Record<string, unknown> = {}, native = true) {
  let emit: (event: ProgressEvent) => void = () => undefined;
  const remove = vi.fn().mockResolvedValue(undefined);
  const addListener = vi.fn((_name: string, fn: (event: ProgressEvent) => void) => {
    emit = fn;
    return Promise.resolve({ remove });
  });
  const scanner = {
    scan: vi.fn().mockResolvedValue({ barcodes: [{ rawValue: 'code' }] }),
    isGoogleBarcodeScannerModuleAvailable: vi.fn().mockResolvedValue({ available: true }),
    installGoogleBarcodeScannerModule: vi.fn().mockResolvedValue(undefined),
    addListener,
    readBarcodesFromImage: vi.fn().mockResolvedValue({ barcodes: [{ rawValue: 'img' }] }),
    ...overrides,
  };
  const picker = { pickFiles: vi.fn().mockResolvedValue({ files: [{ path: '/cache/a.png' }] }) };
  return {
    scanner,
    picker,
    remove,
    emit: (event: ProgressEvent) => emit(event),
    api: createQrScanner(scanner, picker, () => native),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('qrScanner camera scan (Google Code Scanner)', () => {
  it('is unavailable outside the native app', async () => {
    const { api, scanner } = make({}, false);
    expect(await api.scanCamera()).toEqual({ status: 'unavailable' });
    expect(await api.scanImage()).toEqual({ status: 'unavailable' });
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('scans for QR codes only and returns the first text value', async () => {
    const { api, scanner } = make();
    expect(await api.scanCamera()).toEqual({ status: 'ok', text: 'code' });
    expect(scanner.scan).toHaveBeenCalledWith({ formats: ['QR_CODE'] });
    expect(scanner.installGoogleBarcodeScannerModule).not.toHaveBeenCalled();
  });

  it('installs the missing module, reports progress 0, 50, 100 and then scans', async () => {
    const { api, scanner, emit, remove } = make({
      isGoogleBarcodeScannerModuleAvailable: vi.fn().mockResolvedValue({ available: false }),
    });
    const progress = vi.fn();
    const pending = api.scanCamera(progress);
    await tick();
    expect(scanner.scan).not.toHaveBeenCalled();
    emit({ state: State.DOWNLOADING, progress: 50 });
    emit({ state: State.INSTALLING, progress: 100 });
    emit({ state: State.COMPLETED });
    expect(await pending).toEqual({ status: 'ok', text: 'code' });
    expect(progress.mock.calls.map(([percent]) => percent)).toEqual([0, 50, 100]);
    expect(scanner.scan).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it.each([State.FAILED, State.CANCELED])(
    'reports moduleUnavailable when the install ends in state %s',
    async (state) => {
      const { api, scanner, emit } = make({
        isGoogleBarcodeScannerModuleAvailable: vi.fn().mockResolvedValue({ available: false }),
      });
      const pending = api.scanCamera();
      await tick();
      emit({ state });
      expect(await pending).toEqual({ status: 'moduleUnavailable' });
      expect(scanner.scan).not.toHaveBeenCalled();
    },
  );

  it('reports moduleUnavailable when the install request is rejected (no Play services)', async () => {
    const { api, scanner, remove } = make({
      isGoogleBarcodeScannerModuleAvailable: vi.fn().mockResolvedValue({ available: false }),
      installGoogleBarcodeScannerModule: vi.fn().mockRejectedValue(new Error('API not available')),
    });
    expect(await api.scanCamera()).toEqual({ status: 'moduleUnavailable' });
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('reports moduleUnavailable when the availability check itself fails', async () => {
    const { api } = make({
      isGoogleBarcodeScannerModuleAvailable: vi.fn().mockRejectedValue(new Error('not available')),
    });
    expect(await api.scanCamera()).toEqual({ status: 'moduleUnavailable' });
  });

  it('scans when the module turns out to be installed already', async () => {
    const { api } = make({
      isGoogleBarcodeScannerModuleAvailable: vi.fn().mockResolvedValue({ available: false }),
      installGoogleBarcodeScannerModule: vi
        .fn()
        .mockRejectedValue(new Error('The Google Barcode Scanner Module is already installed.')),
    });
    expect(await api.scanCamera()).toEqual({ status: 'ok', text: 'code' });
  });

  it('treats the plugin cancel rejection and an empty result as cancelled', async () => {
    expect(
      await make({ scan: vi.fn().mockRejectedValue(new Error('scan canceled.')) }).api.scanCamera(),
    ).toEqual({ status: 'cancelled' });
    expect(
      await make({ scan: vi.fn().mockResolvedValue({ barcodes: [] }) }).api.scanCamera(),
    ).toEqual({ status: 'cancelled' });
  });

  it('reports none for a code without a text value and error for other failures', async () => {
    expect(
      await make({
        scan: vi.fn().mockResolvedValue({ barcodes: [{} as { rawValue: string }] }),
      }).api.scanCamera(),
    ).toEqual({ status: 'none' });
    expect(
      await make({
        scan: vi.fn().mockRejectedValue(new Error('The scan failed.')),
      }).api.scanCamera(),
    ).toEqual({ status: 'error' });
  });

  it('maps a scan rejected for the missing module to moduleUnavailable', async () => {
    const { api } = make({
      scan: vi
        .fn()
        .mockRejectedValue(new Error('The Google Barcode Scanner Module is not available.')),
    });
    expect(await api.scanCamera()).toEqual({ status: 'moduleUnavailable' });
  });

  it('allows only one scan for rapid taps and frees the slot afterwards', async () => {
    let finishScan: (value: { barcodes: { rawValue: string }[] }) => void = () => undefined;
    const { api, scanner } = make({
      scan: vi.fn(() => new Promise((resolve) => (finishScan = resolve))),
    });
    const first = api.scanCamera();
    expect(await api.scanCamera()).toEqual({ status: 'cancelled' });
    await tick();
    expect(scanner.scan).toHaveBeenCalledOnce();
    finishScan({ barcodes: [{ rawValue: 'one' }] });
    expect(await first).toEqual({ status: 'ok', text: 'one' });
    const second = api.scanCamera();
    await tick();
    finishScan({ barcodes: [{ rawValue: 'two' }] });
    expect(await second).toEqual({ status: 'ok', text: 'two' });
  });

  it('leaves no preview state in the document', async () => {
    const { api } = make();
    await api.scanCamera();
    expect(document.body.className).toBe('');
  });
});

describe('qrScanner image scan', () => {
  it('treats a non-string value like a missing one when decoding an image', async () => {
    const { api } = make({
      readBarcodesFromImage: vi.fn().mockResolvedValue({ barcodes: [{ rawValue: 42 }] }),
    });
    expect(await api.scanImage()).toEqual({ status: 'none' });
  });

  it('decodes a picked image through a file URI', async () => {
    const { api, scanner } = make();
    expect(await api.scanImage()).toEqual({ status: 'ok', text: 'img' });
    expect(scanner.readBarcodesFromImage).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'file:///cache/a.png' }),
    );
  });

  it('reports none for an image without a code or one that cannot be decoded', async () => {
    expect(
      await make({
        readBarcodesFromImage: vi.fn().mockResolvedValue({ barcodes: [] }),
      }).api.scanImage(),
    ).toEqual({ status: 'none' });
    expect(
      await make({
        readBarcodesFromImage: vi.fn().mockRejectedValue(new Error('x')),
      }).api.scanImage(),
    ).toEqual({ status: 'none' });
  });

  it('treats a dismissed picker as cancelled', async () => {
    const { scanner } = make();
    const picker = { pickFiles: vi.fn().mockRejectedValue(new Error('pickFiles canceled.')) };
    expect(await createQrScanner(scanner, picker, () => true).scanImage()).toEqual({
      status: 'cancelled',
    });
  });
});
