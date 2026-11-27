import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pluginMocks = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  startScan: vi.fn(),
  setTheme: vi.fn(),
  cleanupOutput: vi.fn(),
}));

let mockIsNative = false;
let mockPlatformType: 'web' | 'electron' | 'android' = 'web';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNative,
    convertFileSrc: (url: string) => `https://localhost/_capacitor_file_${encodeURI(url.replace('file://', ''))}`,
  },
  registerPlugin: () => pluginMocks,
}));

vi.mock('./index', () => ({
  getPlatformType: () => mockPlatformType,
}));

import {
  cleanupScannerOutput,
  getActiveReactTheme,
  isDocumentScannerAvailable,
  scanDocumentToOpenedFile,
  syncDocumentScannerTheme,
} from './scanner';

describe('DocumentScanner Capacitor bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNative = false;
    mockPlatformType = 'web';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unavailable on Web and Electron without calling native plugin', async () => {
    for (const platform of ['web', 'electron'] as const) {
      mockPlatformType = platform;
      const res = await isDocumentScannerAvailable();
      expect(res).toEqual({
        available: false,
        hasCameraHardware: false,
        hasCameraPermission: false,
      });
      await expect(scanDocumentToOpenedFile()).rejects.toThrow(/only available on Android/i);
    }
    expect(pluginMocks.isAvailable).not.toHaveBeenCalled();
    expect(pluginMocks.startScan).not.toHaveBeenCalled();
  });

  it('forwards availability check on native Android', async () => {
    mockIsNative = true;
    mockPlatformType = 'android';
    pluginMocks.isAvailable.mockResolvedValue({
      available: true,
      hasCameraHardware: true,
      hasCameraPermission: false,
    });

    const res = await isDocumentScannerAvailable();
    expect(pluginMocks.isAvailable).toHaveBeenCalledTimes(1);
    expect(res.available).toBe(true);
    expect(res.hasCameraPermission).toBe(false);
  });

  it('handles scanner cancellation cleanly without reading or deleting files', async () => {
    mockIsNative = true;
    mockPlatformType = 'android';
    pluginMocks.startScan.mockResolvedValue({ status: 'cancelled' });

    const res = await scanDocumentToOpenedFile({ autoCaptureDefault: true });
    expect(res).toEqual({ status: 'cancelled' });
    expect(pluginMocks.cleanupOutput).not.toHaveBeenCalled();
  });

  it('reads completed PDF bytes via convertFileSrc and cleans up temporary file', async () => {
    mockIsNative = true;
    mockPlatformType = 'android';
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    pluginMocks.startScan.mockResolvedValue({
      status: 'completed',
      action: 'save',
      pdfFileUrl: 'file:///data/user/0/org.intabtools.intabpdf/cache/scanner_outputs/scan_1.pdf',
      fileName: 'ReceiptScan',
      pageCount: 2,
    });
    pluginMocks.cleanupOutput.mockResolvedValue({ deleted: true });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pdfBytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await scanDocumentToOpenedFile();
    expect(res.status).toBe('completed');
    if (res.status === 'completed') {
      expect(res.action).toBe('save');
      expect(res.file.name).toBe('ReceiptScan.pdf');
      expect(res.file.bytes).toEqual(pdfBytes);
      expect(res.pageCount).toBe(2);
    }
    expect(pluginMocks.cleanupOutput).toHaveBeenCalledWith({
      pdfFileUrl: 'file:///data/user/0/org.intabtools.intabpdf/cache/scanner_outputs/scan_1.pdf',
    });
  });

  it('defaults action to save rather than view when native result omits action', async () => {
    mockIsNative = true;
    mockPlatformType = 'android';
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    pluginMocks.startScan.mockResolvedValue({
      status: 'completed',
      pdfFileUrl: 'file:///data/user/0/org.intabtools.intabpdf/cache/scanner_outputs/scan_2.pdf',
      fileName: 'Scan_20261126.pdf',
      pageCount: 1,
    });
    pluginMocks.cleanupOutput.mockResolvedValue({ deleted: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => pdfBytes.buffer,
      }),
    );

    const res = await scanDocumentToOpenedFile();
    expect(res.status).toBe('completed');
    if (res.status === 'completed') {
      expect(res.action).toBe('save');
    }
  });

  it('still triggers cleanup when reading the returned PDF fails', async () => {
    mockIsNative = true;
    mockPlatformType = 'android';
    pluginMocks.startScan.mockResolvedValue({
      status: 'completed',
      pdfFileUrl: 'file:///cache/scanner_outputs/broken.pdf',
      pageCount: 1,
    });
    pluginMocks.cleanupOutput.mockResolvedValue({ deleted: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(scanDocumentToOpenedFile()).rejects.toThrow(/HTTP 404/);
    expect(pluginMocks.cleanupOutput).toHaveBeenCalledWith({
      pdfFileUrl: 'file:///cache/scanner_outputs/broken.pdf',
    });

    // cleanupScannerOutput suppresses native cleanup errors cleanly
    pluginMocks.cleanupOutput.mockRejectedValueOnce(new Error('IO'));
    await expect(cleanupScannerOutput('file:///cache/scanner_outputs/broken.pdf')).resolves.toBeUndefined();
  });

  it('rejects non-PDF corrupted output payloads while still cleaning up temporary files', async () => {
    mockIsNative = true;
    mockPlatformType = 'android';
    pluginMocks.startScan.mockResolvedValue({
      status: 'completed',
      pdfFileUrl: 'file:///cache/scanner_outputs/not_a_pdf.pdf',
      pageCount: 1,
    });
    pluginMocks.cleanupOutput.mockResolvedValue({ deleted: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer,
      }),
    );

    await expect(scanDocumentToOpenedFile()).rejects.toThrow(/not a valid PDF/i);
    expect(pluginMocks.cleanupOutput).toHaveBeenCalledWith({
      pdfFileUrl: 'file:///cache/scanner_outputs/not_a_pdf.pdf',
    });
  });

  it('resolves React explicit dataset theme over system prefers-color-scheme and syncs live changes only while scan is active', async () => {
    mockIsNative = true;
    mockPlatformType = 'android';
    pluginMocks.setTheme.mockResolvedValue({ updated: true });

    let observedAttrs: Record<string, string> = { 'data-theme': 'light' };
    const observerCallbacks: Array<() => void> = [];
    const disconnectSpy = vi.fn();

    class FakeMutationObserver {
      private cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        observerCallbacks.push(cb);
      }
      observe() {}
      disconnect() {
        const idx = observerCallbacks.indexOf(this.cb);
        if (idx >= 0) observerCallbacks.splice(idx, 1);
        disconnectSpy();
      }
    }

    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {
          get theme() {
            return observedAttrs['data-theme'];
          },
        },
      },
    });

    // React says light even though matchMedia dark is true
    expect(getActiveReactTheme()).toBe('light');

    let resolveScan!: (val: { status: 'cancelled' }) => void;
    pluginMocks.startScan.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve;
        }),
    );

    const scanPromise = scanDocumentToOpenedFile({ autoCaptureDefault: true });
    expect(pluginMocks.startScan).toHaveBeenCalledWith(
      expect.objectContaining({ autoCaptureDefault: true, theme: 'light' }),
    );

    // Live theme switch from light -> dark while scanner is active
    observedAttrs = { 'data-theme': 'dark' };
    observerCallbacks.forEach((cb) => cb());
    expect(pluginMocks.setTheme).toHaveBeenCalledWith({ theme: 'dark' });

    // Live theme switch back dark -> light while scanner is active
    observedAttrs = { 'data-theme': 'light' };
    observerCallbacks.forEach((cb) => cb());
    expect(pluginMocks.setTheme).toHaveBeenCalledWith({ theme: 'light' });
    expect(pluginMocks.setTheme).toHaveBeenCalledTimes(2);

    // Complete scan -> observer disconnects and later toggles do not trigger setTheme
    resolveScan({ status: 'cancelled' });
    await expect(scanPromise).resolves.toEqual({ status: 'cancelled' });
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    // Next launch passes updated React theme ('dark')
    observedAttrs = { 'data-theme': 'dark' };
    pluginMocks.startScan.mockResolvedValueOnce({ status: 'cancelled' });
    await expect(scanDocumentToOpenedFile()).resolves.toEqual({ status: 'cancelled' });
    expect(pluginMocks.startScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    );

    // Non-Android sync is a clean no-op
    mockPlatformType = 'web';
    await syncDocumentScannerTheme('dark');
    expect(pluginMocks.setTheme).toHaveBeenCalledTimes(2);
  });
});
