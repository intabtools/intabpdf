import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTrackedBlobUrlCount,
  openPdfInNewTab,
  revokeAllTrackedBlobUrls,
} from './webPdf';

describe('Web PDF viewing in new tab', () => {
  const dummyPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

  beforeEach(() => {
    revokeAllTrackedBlobUrls();
    // Stub global URL methods and window.open in Node test environment
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = vi.fn((obj: Blob | MediaSource) => `blob:mock-url-${'size' in obj ? obj.size : 0}`);
    } else {
      vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => `blob:mock-url-${'size' in obj ? obj.size : 0}`);
    }

    if (typeof URL.revokeObjectURL !== 'function') {
      URL.revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }

    vi.stubGlobal('window', {
      open: vi.fn(() => ({ closed: false } as Window)),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {});
  });

  afterEach(() => {
    revokeAllTrackedBlobUrls();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates an application/pdf Blob and opens it in a new tab', () => {
    const success = openPdfInNewTab(dummyPdfBytes, 'test-doc.pdf');
    expect(success).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('#filename=test-doc.pdf'),
      '_blank'
    );
    expect(getTrackedBlobUrlCount()).toBe(1);
  });

  it('preserves .pdf extension when filename hash hint is generated', () => {
    openPdfInNewTab(dummyPdfBytes, 'invoice');
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('#filename=invoice.pdf'),
      '_blank'
    );
  });

  it('detects popup blocking when window.open returns null or closed window', () => {
    vi.stubGlobal('window', {
      open: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {});

    const success = openPdfInNewTab(dummyPdfBytes, 'blocked.pdf');
    expect(success).toBe(false);
  });

  it('tracks and safely revokes all Blob URLs without memory leaks', () => {
    openPdfInNewTab(dummyPdfBytes, 'doc1.pdf');
    openPdfInNewTab(dummyPdfBytes, 'doc2.pdf');
    expect(getTrackedBlobUrlCount()).toBe(2);

    revokeAllTrackedBlobUrls();
    expect(getTrackedBlobUrlCount()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
