import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';
import { getPlatformType, handleLaunchUri, platform, uint8ArrayToBase64 } from './index';

const require = createRequire(import.meta.url);
const { resolvePdfArg, findPdf } = require('../../electron/args.cjs');

describe('platform adapter', () => {
  it('exposes pickPdfFile, onFileOpened, and saveFile', () => {
    expect(typeof platform.pickPdfFile).toBe('function');
    expect(typeof platform.onFileOpened).toBe('function');
    expect(typeof platform.saveFile).toBe('function');
  });

  it('safely handles onFileOpened when window.intab is not present', () => {
    const unsubscribe = platform.onFileOpened(() => {});
    expect(typeof unsubscribe).toBe('function');
    // Calling unsubscribe should not throw
    expect(() => unsubscribe()).not.toThrow();
  });

  it('detects runtime platform via getPlatformType', () => {
    const p = getPlatformType();
    expect(['android', 'electron', 'web']).toContain(p);
  });

  it('accurately converts Uint8Array to base64 with chunked buffering', () => {
    const sample = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]); // "Hello World"
    const b64 = uint8ArrayToBase64(sample);
    expect(b64).toBe(btoa('Hello World'));

    // Test large buffer spanning multiple chunks (> 32KB)
    const large = new Uint8Array(40000);
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256;
    }
    const largeB64 = uint8ArrayToBase64(large);
    expect(typeof largeB64).toBe('string');
    expect(largeB64.length).toBeGreaterThan(0);
  });

  it('handles platform.saveFile gracefully in web/electron document environment', async () => {
    const sample = new Uint8Array([37, 80, 68, 70]); // %PDF
    expect(platform.saveFile).toBeDefined();
    const result = await platform.saveFile!(sample, 'test-doc.pdf', 'application/pdf');
    expect(result).toEqual({ saved: true, fileName: 'test-doc.pdf' });
  });

  describe('external launch events and Android NativeIntent integration', () => {
    interface TestWindow {
      NativeIntent?: {
        hasPendingPdf?: () => boolean;
        getPendingPdf?: () => string;
        clearPendingPdf?: () => void;
        resolveNativePdf?: (uri: string) => string;
      };
    }

    const getTestWindow = (): TestWindow => {
      const g = globalThis as unknown as { window?: TestWindow };
      if (!g.window) {
        g.window = {};
      }
      return g.window;
    };

    it('detects pending file from NativeIntent and allows consuming exactly once', () => {
      let pendingState = true;
      const win = getTestWindow();
      win.NativeIntent = {
        hasPendingPdf: () => pendingState,
        getPendingPdf: () => 'content://media/external/file/1234',
        clearPendingPdf: () => {
          pendingState = false;
        },
      };

      // Initially detected
      expect(platform.hasPendingFile?.()).toBe(true);
      // Consumed flag prevents duplicate detection
      expect(platform.hasPendingFile?.()).toBe(false);

      // Resetting via clearPendingFile allows fresh detection if a new intent arrives
      platform.clearPendingFile?.();
      pendingState = true;
      expect(platform.hasPendingFile?.()).toBe(true);

      // Clean up mock
      platform.clearPendingFile?.();
      delete win.NativeIntent;
    });

    it('manages file start, error, and opened listeners properly', () => {
      const unsubStart = platform.onFileOpenStart?.(() => {});
      const unsubError = platform.onFileOpenError?.(() => {});

      expect(typeof unsubStart).toBe('function');
      expect(typeof unsubError).toBe('function');

      unsubStart?.();
      unsubError?.();
    });

    it('deduplicates duplicate launch URI handling within short time window', async () => {
      let openedCalls = 0;
      let startCalls = 0;

      const unsubStart = platform.onFileOpenStart?.(() => {
        startCalls++;
      });
      const unsubOpened = platform.onFileOpened(() => {
        openedCalls++;
      });

      // Mock NativeIntent to return immediate sample PDF
      const win = getTestWindow();
      win.NativeIntent = {
        resolveNativePdf: () => {
          return JSON.stringify({
            success: true,
            name: 'sample.pdf',
            fileUrl: 'file:///fake/path/sample.pdf',
          });
        },
      };

      // Mock fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
      } as Response);

      const testUri = 'content://com.android.providers/100';

      // First trigger
      await handleLaunchUri(testUri);
      expect(startCalls).toBe(1);
      expect(openedCalls).toBe(1);

      // Duplicate trigger immediately after (e.g. appUrlOpen + getPendingPdf)
      await handleLaunchUri(testUri);
      // Counts must NOT increase because it is deduplicated
      expect(startCalls).toBe(1);
      expect(openedCalls).toBe(1);

      // Clean up
      platform.clearPendingFile?.();
      unsubStart?.();
      unsubOpened();
      globalThis.fetch = originalFetch;
      delete win.NativeIntent;
    });

    it('dispatches file open error when resolution fails', async () => {
      let reportedError: string | null = null;
      const unsubError = platform.onFileOpenError?.((err) => {
        reportedError = err;
      });

      const win = getTestWindow();
      win.NativeIntent = {
        resolveNativePdf: () => {
          return JSON.stringify({
            success: false,
            error: 'File permission denied',
          });
        },
      };

      await handleLaunchUri('content://com.android.providers/denied');

      expect(reportedError).toContain('File permission denied');

      platform.clearPendingFile?.();
      unsubError?.();
      delete win.NativeIntent;
    });
  });

  describe('Electron IPC and window.intab integration', () => {
    interface TestDesktopWindow {
      intab?: {
        isPackaged?: boolean;
        hasPendingPdf?: () => boolean;
        clearPendingPdf?: () => void;
        onOpenPdf?: (callback: (file: { name: string; bytes: Uint8Array | number[] }) => void) => () => void;
        onOpenPdfStart?: (callback: (data: { name: string }) => void) => () => void;
        onOpenPdfError?: (callback: (data: { error: string }) => void) => () => void;
        openExternalUrl?: (url: string) => void;
      };
    }

    const getTestWindow = (): TestDesktopWindow => {
      const g = globalThis as unknown as { window?: TestDesktopWindow };
      if (!g.window) {
        g.window = {};
      }
      return g.window;
    };

    it('detects pending file from window.intab and allows consuming exactly once', () => {
      let pendingState = true;
      let clearCalled = false;
      const win = getTestWindow();
      win.intab = {
        hasPendingPdf: () => pendingState,
        clearPendingPdf: () => {
          clearCalled = true;
          pendingState = false;
        },
      };

      expect(platform.hasPendingFile?.()).toBe(true);
      // Consumed flag prevents repeated positive return
      expect(platform.hasPendingFile?.()).toBe(false);

      // Clearing resets internal state and calls bridge
      platform.clearPendingFile?.();
      expect(clearCalled).toBe(true);

      pendingState = true;
      expect(platform.hasPendingFile?.()).toBe(true);

      platform.clearPendingFile?.();
      delete win.intab;
    });

    it('relays open-pdf-start, open-pdf-error, and open-pdf events from Electron bridge', () => {
      let startCb: ((data: { name: string }) => void) | null = null;
      let errorCb: ((data: { error: string }) => void) | null = null;
      let openCb: ((data: { name: string; bytes: number[] }) => void) | null = null;

      const win = getTestWindow();
      win.intab = {
        onOpenPdfStart: (cb) => {
          startCb = cb;
          return () => {
            startCb = null;
          };
        },
        onOpenPdfError: (cb) => {
          errorCb = cb;
          return () => {
            errorCb = null;
          };
        },
        onOpenPdf: (cb) => {
          openCb = cb;
          return () => {
            openCb = null;
          };
        },
      };

      const starts: string[] = [];
      const errors: string[] = [];
      const opened: string[] = [];

      const unsubStart = platform.onFileOpenStart?.((name) => starts.push(name));
      const unsubError = platform.onFileOpenError?.((err) => errors.push(err));
      const unsubOpen = platform.onFileOpened((file) => {
        expect(file.bytes).toBeInstanceOf(Uint8Array);
        opened.push(file.name);
      });

      expect(startCb).toBeDefined();
      expect(errorCb).toBeDefined();
      expect(openCb).toBeDefined();

      if (startCb) {
        (startCb as (data: { name: string }) => void)({ name: 'contract.pdf' });
      }
      expect(starts).toEqual(['contract.pdf']);

      if (errorCb) {
        (errorCb as (data: { error: string }) => void)({ error: 'File read permission denied' });
      }
      expect(errors).toEqual(['File read permission denied']);

      if (openCb) {
        (openCb as (data: { name: string; bytes: number[] }) => void)({ name: 'report.pdf', bytes: [37, 80, 68, 70] });
      }
      expect(opened).toEqual(['report.pdf']);

      // Deduplication: sending identical file immediately should be filtered out
      if (openCb) {
        (openCb as (data: { name: string; bytes: number[] }) => void)({ name: 'report.pdf', bytes: [37, 80, 68, 70] });
      }
      expect(opened).toEqual(['report.pdf']);

      // Cleanup
      unsubStart?.();
      unsubError?.();
      unsubOpen();
      platform.clearPendingFile?.();
      delete win.intab;
    });
  });

  describe('Electron CLI and URI argument resolution', () => {
    it('resolves standard PDF paths', () => {
      const resolved = resolvePdfArg('test.pdf');
      expect(resolved).toBeTruthy();
      expect(resolved?.endsWith('test.pdf')).toBe(true);
    });

    it('resolves file:// URLs including percent-encoded spaces', () => {
      const fileUrl = 'file:///home/user/my%20presentation%20v2.pdf';
      const resolved = resolvePdfArg(fileUrl);
      expect(resolved).toBe('/home/user/my presentation v2.pdf');
    });

    it('ignores CLI flags and non-PDF files', () => {
      expect(resolvePdfArg('--enable-features=UseOzonePlatform')).toBeNull();
      expect(resolvePdfArg('--dev')).toBeNull();
      expect(resolvePdfArg('/path/to/image.png')).toBeNull();
      expect(resolvePdfArg('')).toBeNull();
      expect(resolvePdfArg(null as unknown as string)).toBeNull();
    });

    it('finds PDF in argv skipping executable path at index 0', () => {
      const argv = ['/usr/bin/intabpdf', '--no-sandbox', 'file:///data/annual-report.pdf'];
      const pdf = findPdf(argv);
      expect(pdf).toBe('/data/annual-report.pdf');

      const argvNone = ['/usr/bin/intabpdf', '--dev', '--inspect'];
      expect(findPdf(argvNone)).toBeNull();
    });
  });
});
