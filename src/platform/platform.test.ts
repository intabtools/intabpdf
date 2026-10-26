import { describe, expect, it, vi } from 'vitest';
import { getPlatformType, handleLaunchUri, platform, uint8ArrayToBase64 } from './index';

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
});
