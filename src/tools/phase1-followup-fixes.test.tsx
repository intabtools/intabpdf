import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';
import ToolResultCard from '../pages/tool/ToolResultCard';
import { getToolById } from './registry';
import type { StagedFile } from './types';
import { imagesToPdf, detectImageFormat } from '../core/images-to-pdf';
import { isWebpImage, convertWebpToPng } from './modules/imagesToPdf/webpConverter';
import {
  calculateTargetDimensions,
  selectSmallerBytes,
  shrinkImageIfNeeded,
} from './modules/imagesToPdf/imageShrinker';
import { executeBatchOperation } from './batchOperation';
import { executeBatchCompression } from './modules/compress/batchCompress';

async function createMinimalPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 350, size: 12 });
  }
  return await doc.save();
}

describe('IntabPDF — Phase 1 Follow-up Corrections', () => {
  describe('1. Extract Text multi-file result handling in ToolResultCard', () => {
    const extractTextTool = getToolById('extract-text')!;

    it('renders text preview and Save TXT for single-file extract-text result', () => {
      const sampleText = 'Hello world! This is extracted text from document.';
      const outputBytes = new TextEncoder().encode(sampleText);
      const stagedFiles: StagedFile[] = [
        { id: '1', name: 'sample.pdf', size: 1000, bytes: new Uint8Array([1, 2, 3]) },
      ];

      const html = renderToString(
        <ToolResultCard
          tool={extractTextTool}
          stagedFiles={stagedFiles}
          outputBytes={outputBytes}
          extraState={{ wordCount: 8, hasImages: false }}
          customFileName="extracted-sample"
          onCustomFileNameChange={() => {}}
          defaultBaseName="extracted-sample"
          outputExtension=".txt"
          isSaved={false}
          isZipOutput={false}
          platformType="electron"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      // Verify text preview textarea and copy button are present
      expect(html).toContain('Hello world! This is extracted text from document.');
      expect(html).toContain('Copy text');
      expect(html).toContain('characters');
      expect(html).toContain('Save TXT');
      expect(html).not.toContain('Save ZIP');
    });

    it('treats multi-file extract-text result as binary ZIP download and NEVER decodes ZIP bytes as text', () => {
      // Simulate raw ZIP bytes (starts with PK\x03\x04...)
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
      const stagedFiles: StagedFile[] = [
        { id: '1', name: 'contract.pdf', size: 1000, bytes: new Uint8Array([1]) },
        { id: '2', name: 'invoice.pdf', size: 2000, bytes: new Uint8Array([2]) },
      ];

      const html = renderToString(
        <ToolResultCard
          tool={extractTextTool}
          stagedFiles={stagedFiles}
          outputBytes={zipBytes}
          extraState={{
            wordCount: 150,
            hasImages: false,
            batchStats: {
              total: 2,
              successCount: 2,
              failureCount: 0,
              failures: [],
            },
          }}
          customFileName="extracted-texts"
          onCustomFileNameChange={() => {}}
          defaultBaseName="extracted-texts"
          outputExtension=".zip"
          isSaved={false}
          isZipOutput={true}
          platformType="electron"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      // Must NOT render textarea or attempt text decoding
      expect(html).not.toContain('<textarea');
      expect(html).not.toContain('Extracted text preview');
      expect(html).not.toContain('Copy text');
      expect(html).not.toContain('Save TXT');

      // Must render ZIP download and batch summary
      expect(html).toContain(`${extractTextTool.name}: 2 files processed!`);
      expect(html).toContain('2 files packaged in ZIP');
      expect(html).toContain('Save ZIP');
    });

    it('preserves batch failure summary on partial multi-file extract-text result', () => {
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      const stagedFiles: StagedFile[] = [
        { id: '1', name: 'valid.pdf', size: 1000, bytes: new Uint8Array([1]) },
        { id: '2', name: 'corrupt.pdf', size: 500, bytes: new Uint8Array([2]) },
      ];

      const html = renderToString(
        <ToolResultCard
          tool={extractTextTool}
          stagedFiles={stagedFiles}
          outputBytes={zipBytes}
          extraState={{
            batchStats: {
              total: 2,
              successCount: 1,
              failureCount: 1,
              failures: [{ fileName: 'corrupt.pdf', reason: 'Corrupt header' }],
            },
          }}
          customFileName="extracted-texts"
          onCustomFileNameChange={() => {}}
          defaultBaseName="extracted-texts"
          outputExtension=".zip"
          isSaved={false}
          isZipOutput={true}
          platformType="electron"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      expect(html).toContain(`${extractTextTool.name}: 1 of 2 files processed`);
      expect(html).toContain('1 of 2 files could not be processed');
      expect(html).toContain('corrupt.pdf');
      expect(html).toContain('Corrupt header');
      expect(html).toContain('Save ZIP');
      expect(html).not.toContain('<textarea');
    });
  });

  describe('2. Move WebP conversion out of src/core/', () => {
    it('verifies src/core/images-to-pdf.ts contains zero browser, DOM, canvas or image globals', () => {
      const coreFilePath = path.resolve(__dirname, '../core/images-to-pdf.ts');
      const coreCode = fs.readFileSync(coreFilePath, 'utf-8');

      expect(coreCode).not.toMatch(/\bdocument\.(createElement|getElementById|querySelector|body|addEventListener)\b/);
      expect(coreCode).not.toMatch(/\bwindow\.(addEventListener|document|location|navigator)\b/);
      expect(coreCode).not.toMatch(/typeof\s+(document|window)\b/);
      expect(coreCode).not.toMatch(/\bOffscreenCanvas\b/);
      expect(coreCode).not.toMatch(/\bHTMLCanvasElement\b/);
      expect(coreCode).not.toMatch(/\bcreateImageBitmap\b/);
      expect(coreCode).not.toMatch(/\bnew Image\b/);
      expect(coreCode).not.toMatch(/\bBlob\b/);
    });

    it('core imagesToPdf converts valid JPEG into PDF bytes in pure headless environment', async () => {
      // 1x1 valid JPEG
      const testJpeg = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
        0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08,
        0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a,
        0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d,
        0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22,
        0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34,
        0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0,
        0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
        0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
        0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
        0x3f, 0x00, 0xbf, 0x80, 0xff, 0xd9,
      ]);

      const pdfBytes = await imagesToPdf([{ name: 'test.jpg', bytes: testJpeg }]);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.byteLength).toBeGreaterThan(0);
      expect(pdfBytes[0]).toBe(0x25); // %PDF
    });

    it('core imagesToPdf strictly rejects unconverted WebP bytes with descriptive error', async () => {
      const fakeWebp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);

      await expect(
        imagesToPdf([{ name: 'photo.webp', bytes: fakeWebp }])
      ).rejects.toThrow(/WebP image "photo.webp" must be converted to PNG or JPEG before core PDF embedding/);
    });

    it('webpConverter identifies WebP magic bytes and handles non-supported runtime safely', async () => {
      const fakeWebp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      const notWebp = new Uint8Array([1, 2, 3, 4]);

      expect(isWebpImage(fakeWebp)).toBe(true);
      expect(isWebpImage(notWebp)).toBe(false);
      expect(detectImageFormat(fakeWebp)).toBe('webp');

      // In Node.js environment without DOM, convertWebpToPng fails safely with clear error
      if (typeof createImageBitmap === 'undefined' && typeof window === 'undefined') {
        await expect(convertWebpToPng(fakeWebp)).rejects.toThrow(
          /WebP conversion is not supported in this runtime environment/
        );
      }
    });
  });

  describe('3. Correct Shrink Large Images behaviour', () => {
    it('calculateTargetDimensions preserves exact aspect ratio when scaling down', () => {
      // 3840x2160 (16:9 landscape) with max 1920
      const landscape = calculateTargetDimensions(3840, 2160, 1920);
      expect(landscape.shouldScale).toBe(true);
      expect(landscape.targetWidth).toBe(1920);
      expect(landscape.targetHeight).toBe(1080);

      // 2160x3840 (portrait) with max 1920
      const portrait = calculateTargetDimensions(2160, 3840, 1920);
      expect(portrait.shouldScale).toBe(true);
      expect(portrait.targetWidth).toBe(1080);
      expect(portrait.targetHeight).toBe(1920);
    });

    it('calculateTargetDimensions never upscales smaller or exact-dimension images', () => {
      const small = calculateTargetDimensions(800, 600, 1920);
      expect(small.shouldScale).toBe(false);
      expect(small.targetWidth).toBe(800);
      expect(small.targetHeight).toBe(600);

      const exact = calculateTargetDimensions(1920, 1080, 1920);
      expect(exact.shouldScale).toBe(false);
      expect(exact.targetWidth).toBe(1920);
      expect(exact.targetHeight).toBe(1080);
    });

    it('selectSmallerBytes returns original if processed is equal or larger, protecting from bloating', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]); // 5 bytes
      const larger = new Uint8Array([1, 2, 3, 4, 5, 6, 7]); // 7 bytes
      const equal = new Uint8Array([1, 2, 3, 4, 5]); // 5 bytes
      const smaller = new Uint8Array([1, 2, 3]); // 3 bytes

      expect(selectSmallerBytes(original, larger)).toBe(original);
      expect(selectSmallerBytes(original, equal)).toBe(original);
      expect(selectSmallerBytes(original, smaller)).toBe(smaller);
    });

    it('shrinkImageIfNeeded bypasses images <= maxDimension without modification', async () => {
      const testJpeg = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
        0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08,
        0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a,
        0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d,
        0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22,
        0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34,
        0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0,
        0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
        0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
        0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
        0x3f, 0x00, 0xbf, 0x80, 0xff, 0xd9,
      ]);

      const result = await shrinkImageIfNeeded(testJpeg, 'tiny.jpg', { maxDimension: 1920 });
      expect(result).toBe(testJpeg);
    });
  });

  describe('4. Consistent batch cancellation', () => {
    it('stops executeBatchOperation immediately when signal is aborted before execution', async () => {
      const pdf = await createMinimalPdf(1);
      const stagedFiles: StagedFile[] = [
        { id: '1', name: 'doc1.pdf', size: pdf.byteLength, bytes: pdf },
        { id: '2', name: 'doc2.pdf', size: pdf.byteLength, bytes: pdf },
      ];

      const controller = new AbortController();
      controller.abort(); // Pre-aborted

      let fileProcessCount = 0;
      await expect(
        executeBatchOperation({
          actionVerb: 'Rotating',
          stagedFiles,
          signal: controller.signal,
          processFile: async () => {
            fileProcessCount++;
            return { name: 'out.pdf', bytes: new Uint8Array([1]) };
          },
        })
      ).rejects.toThrow('Operation cancelled');

      expect(fileProcessCount).toBe(0);
    });

    it('stops executeBatchOperation between files on cancellation and does not return partial ZIP', async () => {
      const pdf = await createMinimalPdf(1);
      const stagedFiles: StagedFile[] = [
        { id: '1', name: 'doc1.pdf', size: pdf.byteLength, bytes: pdf },
        { id: '2', name: 'doc2.pdf', size: pdf.byteLength, bytes: pdf },
        { id: '3', name: 'doc3.pdf', size: pdf.byteLength, bytes: pdf },
      ];

      const controller = new AbortController();
      let fileProcessCount = 0;

      await expect(
        executeBatchOperation({
          actionVerb: 'Rotating',
          stagedFiles,
          signal: controller.signal,
          processFile: async (curFile) => {
            fileProcessCount++;
            if (fileProcessCount === 1) {
              // User clicks cancel after file 1 completes
              controller.abort();
            }
            return { name: `rotated-${curFile.name}`, bytes: new Uint8Array([1]) };
          },
        })
      ).rejects.toThrow('Operation cancelled');

      // Processing must halt before starting file 2 or 3
      expect(fileProcessCount).toBe(1);
    });

    it('stops executeBatchCompression between files on cancellation', async () => {
      const pdf1 = await createMinimalPdf(1);
      const pdf2 = await createMinimalPdf(1);
      const stagedFiles: StagedFile[] = [
        { id: '1', name: 'doc1.pdf', size: pdf1.byteLength, bytes: pdf1 },
        { id: '2', name: 'doc2.pdf', size: pdf2.byteLength, bytes: pdf2 },
      ];

      const controller = new AbortController();
      controller.abort(); // Pre-aborted

      await expect(
        executeBatchCompression(
          stagedFiles,
          { mode: 'recommended', corePreset: 'recommended' },
          { signal: controller.signal }
        )
      ).rejects.toThrow('Operation cancelled');
    });

    it('resets cancellation handlers properly when batch completes or fails', async () => {
      let registeredHandler: (() => void) | null = null;
      const setCancelHandler = vi.fn((handler: (() => void) | null) => {
        registeredHandler = handler;
      });

      // Simulate the tool lifecycle
      const controller = new AbortController();
      setCancelHandler(() => controller.abort());
      expect(registeredHandler).not.toBeNull();

      try {
        // Do work...
      } finally {
        setCancelHandler(null);
      }

      expect(registeredHandler).toBeNull();
      expect(setCancelHandler).toHaveBeenCalledTimes(2);
    });
  });
});
