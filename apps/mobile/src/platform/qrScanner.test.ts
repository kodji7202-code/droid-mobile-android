import { describe, expect, it, vi } from 'vitest';
import { createQrScanner, isCameraScanActive } from './qrScanner';

function make(overrides: Record<string, unknown> = {}, native = true) {
  type Handler = (event: { barcodes: { rawValue: string }[] }) => void;
  const handlers: Record<string, Handler> = {};
  const remove = vi.fn().mockResolvedValue(undefined);
  const addListener = vi.fn((name: string, fn: Handler) => {
    handlers[name] = fn;
    return Promise.resolve({ remove });
  });
  const scanner = {
    requestPermissions: vi.fn().mockResolvedValue({ camera: 'granted' }),
    startScan: vi.fn().mockResolvedValue(undefined),
    stopScan: vi.fn().mockResolvedValue(undefined),
    addListener,
    readBarcodesFromImage: vi.fn().mockResolvedValue({ barcodes: [{ rawValue: 'img' }] }),
    ...overrides,
  };
  const picker = { pickFiles: vi.fn().mockResolvedValue({ files: [{ path: '/cache/a.png' }] }) };
  const back = { addListener };
  return { scanner, picker, handlers, api: createQrScanner(scanner, picker, () => native, back) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('qrScanner', () => {
  it('is unavailable outside the native app', async () => {
    const { api, scanner } = make({}, false);
    expect(await api.scanCamera()).toEqual({ status: 'unavailable' });
    expect(await api.scanImage()).toEqual({ status: 'unavailable' });
    expect(scanner.requestPermissions).not.toHaveBeenCalled();
  });

  it('starts the live preview after permission and resolves on the first QR', async () => {
    const { api, scanner, handlers } = make();
    const pending = api.scanCamera();
    await tick();
    expect(scanner.startScan).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('barcode-scanner-active')).toBe(true);
    expect(isCameraScanActive()).toBe(true);
    handlers.barcodesScanned({ barcodes: [{ rawValue: 'code' }] });
    expect(await pending).toEqual({ status: 'ok', text: 'code' });
    expect(scanner.stopScan).toHaveBeenCalled();
    expect(document.body.classList.contains('barcode-scanner-active')).toBe(false);
    await tick();
    expect(isCameraScanActive()).toBe(false);
  });

  it('reports denied without opening the preview', async () => {
    const { api, scanner } = make({
      requestPermissions: vi.fn().mockResolvedValue({ camera: 'denied' }),
    });
    expect(await api.scanCamera()).toEqual({ status: 'denied' });
    expect(scanner.startScan).not.toHaveBeenCalled();
  });

  it('cancels on the back button and on stopCamera', async () => {
    const a = make();
    const first = a.api.scanCamera();
    await tick();
    a.handlers.backButton({ barcodes: [] });
    expect(await first).toEqual({ status: 'cancelled' });

    const b = make();
    const second = b.api.scanCamera();
    await tick();
    await b.api.stopCamera();
    expect(await second).toEqual({ status: 'cancelled' });
  });

  it('rejects a barcode without a text value as none and stops the camera', async () => {
    const { api, scanner, handlers } = make();
    const pending = api.scanCamera();
    await tick();
    expect(() =>
      handlers.barcodesScanned({ barcodes: [{} as { rawValue: string }] }),
    ).not.toThrow();
    expect(await pending).toEqual({ status: 'none' });
    expect(scanner.stopScan).toHaveBeenCalled();
    expect(document.body.classList.contains('barcode-scanner-active')).toBe(false);
  });

  it('treats a non-string value like a missing one when decoding an image', async () => {
    const { api } = make({
      readBarcodesFromImage: vi.fn().mockResolvedValue({ barcodes: [{ rawValue: 42 }] }),
    });
    expect(await api.scanImage()).toEqual({ status: 'none' });
  });

  it('allows only one scan for rapid taps and requests permission once', async () => {
    let grant: (value: { camera: string }) => void = () => undefined;
    const { api, scanner, handlers } = make({
      requestPermissions: vi.fn(() => new Promise((resolve) => (grant = resolve))),
    });
    const first = api.scanCamera();
    const second = api.scanCamera();
    expect(await second).toEqual({ status: 'cancelled' });
    expect(scanner.requestPermissions).toHaveBeenCalledOnce();
    grant({ camera: 'granted' });
    await tick();
    expect(scanner.startScan).toHaveBeenCalledOnce();
    handlers.barcodesScanned({ barcodes: [{ rawValue: 'code' }] });
    expect(await first).toEqual({ status: 'ok', text: 'code' });
  });

  it('does not let a finished scan clean up a newer scan', async () => {
    type Handler = (event: { barcodes: { rawValue: string }[] }) => void;
    const handlers: Record<string, Handler> = {};
    const releases: (() => void)[] = [];
    let first = true;
    const addListener = vi.fn((name: string, fn: Handler) => {
      handlers[name] = fn;
      const slow = first && name === 'barcodesScanned';
      if (slow) first = false;
      const remove = slow
        ? () => new Promise<void>((resolve) => releases.push(resolve))
        : () => Promise.resolve();
      return Promise.resolve({ remove });
    });
    const scanner = {
      requestPermissions: vi.fn().mockResolvedValue({ camera: 'granted' }),
      startScan: vi.fn().mockResolvedValue(undefined),
      stopScan: vi.fn().mockResolvedValue(undefined),
      addListener,
      readBarcodesFromImage: vi.fn(),
    };
    const api = createQrScanner(scanner, { pickFiles: vi.fn() }, () => true, { addListener });

    const one = api.scanCamera();
    await tick();
    handlers.barcodesScanned({ barcodes: [{ rawValue: 'one' }] });
    await tick();
    // The first scan is still removing its listener: its slot stays reserved.
    scanner.stopScan.mockClear();
    expect(await api.scanCamera()).toEqual({ status: 'cancelled' });
    expect(scanner.startScan).toHaveBeenCalledTimes(1);
    releases.forEach((release) => release());
    expect(await one).toEqual({ status: 'ok', text: 'one' });
    expect(scanner.stopScan).toHaveBeenCalledTimes(1);

    const two = api.scanCamera();
    await tick();
    expect(scanner.startScan).toHaveBeenCalledTimes(2);
    await api.stopCamera();
    expect(await two).toEqual({ status: 'cancelled' });
  });
  it('reports an error when the preview cannot start', async () => {
    const { api } = make({ startScan: vi.fn().mockRejectedValue(new Error('boom')) });
    expect(await api.scanCamera()).toEqual({ status: 'error' });
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
    expect(
      await createQrScanner(scanner, picker, () => true, { addListener: vi.fn() }).scanImage(),
    ).toEqual({ status: 'cancelled' });
  });
});
