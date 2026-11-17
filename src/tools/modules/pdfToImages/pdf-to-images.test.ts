import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import { parseImagePageSelection } from './pageSelection';
import { canvasToBytes, renderPdfToImages } from './renderer';
import { LARGE_BATCH_THRESHOLD_3X, MAX_CUMULATIVE_BYTES } from './types';
import ProcessingLoadingScreen from '../../../components/ProcessingLoadingScreen';
import PdfToImagesTool from '../PdfToImagesTool';
import { ToastProvider } from '../../../components/ToastContext';
import { getToolById } from '../../registry';

async function createTestPdf(pageCount = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`Test Page ${i}`, { x: 30, y: 350, size: 14 });
  }
  return await doc.save();
}

function createMockCanvas(width = 0, height = 0) {
  const canvas: Record<string, unknown> = {
    width,
    height,
    style: { width: `${width}px`, height: `${height}px` },
    toBlob: (callback: (blob: Blob | null) => void, type?: string) => {
      const fakeBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      callback(new Blob([fakeBytes], { type: type || 'image/png' }));
    },
    toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  };

  const context: Record<string, unknown> = {
    canvas,
    fillStyle: '#000000',
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    getTransform: vi.fn().mockReturnValue({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 10 }),
    fillText: vi.fn(),
    strokeText: vi.fn(),
  };

  canvas.getContext = (id: string) => (id === '2d' ? context : null);
  return canvas as unknown as HTMLCanvasElement;
}

describe('PDF to Images Feature Suite', () => {
  describe('Page Selection Parser (parseImagePageSelection)', () => {
    it('selects all pages when input is empty or "all"', () => {
      expect(parseImagePageSelection('', 5)).toEqual({ pages: [1, 2, 3, 4, 5] });
      expect(parseImagePageSelection('   ', 3)).toEqual({ pages: [1, 2, 3] });
      expect(parseImagePageSelection('all', 4)).toEqual({ pages: [1, 2, 3, 4] });
      expect(parseImagePageSelection('ALL', 2)).toEqual({ pages: [1, 2] });
    });

    it('parses individual page numbers and ranges', () => {
      expect(parseImagePageSelection('1', 5)).toEqual({ pages: [1] });
      expect(parseImagePageSelection('1-3', 5)).toEqual({ pages: [1, 2, 3] });
      expect(parseImagePageSelection('1, 3, 5', 5)).toEqual({ pages: [1, 3, 5] });
      expect(parseImagePageSelection('1-2, 4-5', 5)).toEqual({ pages: [1, 2, 4, 5] });
    });

    it('deduplicates overlapping pages and sorts in ascending order', () => {
      expect(parseImagePageSelection('3, 1, 2, 1-3', 5)).toEqual({ pages: [1, 2, 3] });
      expect(parseImagePageSelection('4-5, 2-3, 1', 5)).toEqual({ pages: [1, 2, 3, 4, 5] });
    });

    it('returns descriptive error for reversed ranges', () => {
      const res = parseImagePageSelection('4-2', 5);
      expect(res.error).toContain('Reversed range');
      expect(res.pages).toEqual([]);
    });

    it('returns descriptive error for out-of-bounds page numbers', () => {
      const res1 = parseImagePageSelection('6', 5);
      expect(res1.error).toContain('exceeds total document pages (5)');

      const res2 = parseImagePageSelection('2-8', 5);
      expect(res2.error).toContain('exceeds total document pages (5)');
    });

    it('returns descriptive error for zero or negative page numbers', () => {
      const res = parseImagePageSelection('0', 5);
      expect(res.error).toContain('must be 1 or greater');
    });

    it('returns descriptive error for invalid non-integer inputs', () => {
      const res1 = parseImagePageSelection('abc', 5);
      expect(res1.error).toContain('Must be an integer');

      const res2 = parseImagePageSelection('1-x', 5);
      expect(res2.error).toContain('must be integers');

      const res3 = parseImagePageSelection('1-2-3', 5);
      expect(res3.error).toContain('Invalid range format');
    });

    it('returns error when document has no valid pages', () => {
      const res = parseImagePageSelection('1', 0);
      expect(res.error).toContain('The document contains no valid pages.');
    });
  });

  describe('Canvas Encoding Helper (canvasToBytes)', () => {
    it('encodes canvas via toBlob when available', async () => {
      const fakeBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
      const mockCanvas = {
        toBlob: vi.fn((cb) => cb(fakeBlob)),
      } as unknown as HTMLCanvasElement;

      const bytes = await canvasToBytes(mockCanvas, 'image/png');
      expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
    });

    it('falls back to toDataURL when toBlob is unavailable', async () => {
      const mockCanvas = {
        toDataURL: vi.fn(() => 'data:image/png;base64,AQIDBA=='),
      } as unknown as HTMLCanvasElement;

      const bytes = await canvasToBytes(mockCanvas, 'image/png');
      expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(mockCanvas.toDataURL).toHaveBeenCalled();
    });
  });

  describe('Core Conversion Engine (renderPdfToImages)', () => {
    let origDocument: unknown;
    let origWindow: unknown;

    beforeEach(() => {
      origDocument = (globalThis as unknown as { document?: unknown }).document;
      origWindow = (globalThis as unknown as { window?: unknown }).window;

      (globalThis as unknown as { document: unknown }).document = {
        createElement: (tag: string) => {
          if (tag === 'canvas') {
            return createMockCanvas();
          }
          return { style: {} };
        },
      };

      (globalThis as unknown as { window: unknown }).window = {
        devicePixelRatio: 1,
        requestAnimationFrame: (cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 0),
        cancelAnimationFrame: (id: NodeJS.Timeout) => clearTimeout(id),
      };
    });

    afterEach(() => {
      (globalThis as unknown as { document: unknown }).document = origDocument;
      (globalThis as unknown as { window: unknown }).window = origWindow;
      vi.restoreAllMocks();
    });

    it('converts a single page to a direct PNG image file (no ZIP)', async () => {
      const pdfBytes = await createTestPdf(3);
      const result = await renderPdfToImages(pdfBytes, {
        format: 'png',
        scale: 1,
        pages: [2],
      });

      expect(result.isZip).toBe(false);
      expect(result.outputExtension).toBe('.png');
      expect(result.pageCount).toBe(1);
      expect(result.format).toBe('png');
      expect(result.scale).toBe(1);
      expect(result.singleFileName).toBe('page-002.png');
      expect(result.outputBytes.byteLength).toBeGreaterThan(0);
      expect(result.images).toHaveLength(1);
      expect(result.images[0].pageNumber).toBe(2);
    });

    it('converts a single page to a direct JPEG image file with quality', async () => {
      const pdfBytes = await createTestPdf(2);
      const result = await renderPdfToImages(pdfBytes, {
        format: 'jpeg',
        scale: 2,
        jpegQuality: 0.85,
        pages: [1],
      });

      expect(result.isZip).toBe(false);
      expect(result.outputExtension).toBe('.jpg');
      expect(result.pageCount).toBe(1);
      expect(result.format).toBe('jpeg');
      expect(result.scale).toBe(2);
      expect(result.singleFileName).toBe('page-001.jpg');
      expect(result.outputBytes.byteLength).toBeGreaterThan(0);
    });

    it('converts multiple pages into a valid ZIP archive containing ordered image files', async () => {
      const pdfBytes = await createTestPdf(3);
      const progressSteps: number[] = [];

      const result = await renderPdfToImages(pdfBytes, {
        format: 'png',
        scale: 1,
        pages: [1, 2, 3],
        onProgress: (p) => progressSteps.push(p.current),
      });

      expect(result.isZip).toBe(true);
      expect(result.outputExtension).toBe('.zip');
      expect(result.pageCount).toBe(3);
      expect(result.images).toHaveLength(3);
      expect(result.images[0].fileName).toBe('page-001.png');
      expect(result.images[1].fileName).toBe('page-002.png');
      expect(result.images[2].fileName).toBe('page-003.png');

      // Valid ZIP archive check (PK\x03\x04 signature)
      expect(result.outputBytes[0]).toBe(0x50); // P
      expect(result.outputBytes[1]).toBe(0x4b); // K
      expect(result.outputBytes[2]).toBe(0x03);
      expect(result.outputBytes[3]).toBe(0x04);

      // Verify progress callback was triggered sequentially
      expect(progressSteps).toEqual([1, 2, 3]);
    });

    it('supports cancellation midway through page processing', async () => {
      const pdfBytes = await createTestPdf(5);
      const abortController = new AbortController();

      // Trigger abort on page 2
      const conversionPromise = renderPdfToImages(pdfBytes, {
        format: 'png',
        scale: 1,
        pages: [1, 2, 3, 4, 5],
        signal: abortController.signal,
        onProgress: (p) => {
          if (p.current === 2) {
            abortController.abort();
          }
        },
      });

      await expect(conversionPromise).rejects.toThrow('Conversion cancelled');
    });

    it('aborts immediately when signal is already cancelled prior to starting', async () => {
      const pdfBytes = await createTestPdf(2);
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        renderPdfToImages(pdfBytes, {
          format: 'png',
          scale: 1,
          pages: [1, 2],
          signal: abortController.signal,
        })
      ).rejects.toThrow('Conversion cancelled');
    });

    it('rejects with helpful error on corrupted or empty PDF buffer', async () => {
      const corruptBytes = new Uint8Array([1, 2, 3, 4, 5]);

      await expect(
        renderPdfToImages(corruptBytes, {
          format: 'png',
          scale: 1,
          pages: [1],
        })
      ).rejects.toThrow();

      await expect(
        renderPdfToImages(new Uint8Array(0), {
          format: 'png',
          scale: 1,
          pages: [1],
        })
      ).rejects.toThrow('No PDF file provided for conversion.');
    });

    it('rejects when empty page list is provided', async () => {
      const pdfBytes = await createTestPdf(2);
      await expect(
        renderPdfToImages(pdfBytes, {
          format: 'png',
          scale: 1,
          pages: [],
        })
      ).rejects.toThrow('No pages selected for conversion.');
    });

    it('enforces cumulative output memory threshold safeguard (MAX_CUMULATIVE_BYTES)', async () => {
      const pdfBytes = await createTestPdf(3);

      // Supply a 5-byte maxCumulativeBytes threshold to simulate exceeding memory limit
      await expect(
        renderPdfToImages(pdfBytes, {
          format: 'png',
          scale: 1,
          pages: [1, 2, 3],
          maxCumulativeBytes: 5,
        })
      ).rejects.toThrow(/Cumulative image output exceeded memory safety threshold/i);
    });

    it('exports memory safeguard and batch threshold constants with technical justification', () => {
      expect(MAX_CUMULATIVE_BYTES).toBe(500 * 1024 * 1024);
      expect(LARGE_BATCH_THRESHOLD_3X).toBe(30);
    });
  });

  describe('ProcessingLoadingScreen Cancellation Integration', () => {
    it('omits Cancel button entirely when onCancel is not provided (backward-compatible for existing tools)', () => {
      const html = renderToString(React.createElement(ProcessingLoadingScreen, { message: 'Merging PDFs…' }));
      expect(html).toContain('processing-full-loading-screen');
      expect(html).toContain('Merging PDFs…');
      expect(html).not.toContain('processing-cancel-btn');
      expect(html).not.toContain('Cancel');
    });

    it('renders a clearly visible, responsive Cancel button when onCancel is provided', () => {
      const onCancel = vi.fn();
      const html = renderToString(
        React.createElement(ProcessingLoadingScreen, {
          message: 'Converting page 2 of 10 (20%)…',
          onCancel,
        })
      );

      expect(html).toContain('processing-full-loading-screen');
      expect(html).toContain('Converting page 2 of 10 (20%)…');
      expect(html).toContain('class="processing-cancel-btn"');
      expect(html).toContain('Cancel');
      expect(html).toContain('aria-label="Cancel processing"');
    });
  });

  describe('Tool Definition & Registry Integration', () => {
    it('is registered as available in tool registry with valid component loader', async () => {
      const tool = getToolById('pdf-to-images');
      expect(tool).toBeDefined();
      expect(tool?.availability).toBe('available');
      expect(tool?.category).toBe('Sign and convert');
      expect(tool?.component).toBeTypeOf('function');

      // Test lazy loader resolution
      const loaded = await tool?.component?.();
      expect(loaded).toBeDefined();
      expect(loaded?.default).toBeTypeOf('function');
    });

    it('renders PdfToImagesTool options structure properly', () => {
      const tool = getToolById('pdf-to-images')!;
      const html = renderToString(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(PdfToImagesTool, {
            tool,
            stagedFiles: [],
            optionsState: {},
            onOptionsChange: vi.fn(),
            onExecute: vi.fn(),
            isProcessing: false,
            onExtraStateChange: vi.fn(),
          })
        )
      );
      expect(html).toMatch(/PDF to images.*options/);
      expect(html).toContain('Image format');
      expect(html).toContain('Resolution');
      expect(html).toContain('Pages to convert');
    });
  });
});
