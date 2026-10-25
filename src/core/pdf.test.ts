import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { destroyPdf, getPageSize, loadPdf } from '../viewer/renderPage';
import {
  calculateCompressionStats,
  compressPdf,
  createZip,
  crc32,
  detectImageFormat,
  imagesToPdf,
  mergePdfs,
  parsePageRanges,
  parseRemovePageInput,
  removePdfPages,
  rotatePdfPages,
  splitPdfPages,
} from './index';

// Valid 1x1 PNG bytes
const TEST_PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// Valid 2x1 landscape PNG bytes
const TEST_PNG_2X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x3e, 0x1a, 0x24, 0x81, 0x00, 0x00, 0x00,
  0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00,
  0x00, 0x0a, 0x00, 0x02, 0x9c, 0xec, 0x06, 0x59, 0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// Valid 1x2 portrait PNG bytes
const TEST_PNG_1X2 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x9c, 0x83, 0x6b, 0xbb, 0x00, 0x00, 0x00,
  0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00,
  0x00, 0x0a, 0x00, 0x02, 0x9c, 0xec, 0x06, 0x59, 0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// Valid 1x1 JPEG bytes
const TEST_JPEG_1X1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03, 0x02, 0x02,
  0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x04, 0x08, 0x06, 0x06, 0x05,
  0x06, 0x09, 0x08, 0x0a, 0x0a, 0x09, 0x08, 0x09, 0x09, 0x0a, 0x0c, 0x0f, 0x0c, 0x0a, 0x0b, 0x0e,
  0x0b, 0x09, 0x09, 0x0d, 0x11, 0x0d, 0x0e, 0x0f, 0x10, 0x10, 0x11, 0x10, 0x0a, 0x0c, 0x12, 0x13,
  0x12, 0x10, 0x13, 0x0f, 0x10, 0x10, 0x10, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
  0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
  0x00, 0x00, 0x3f, 0x00, 0x37, 0xff, 0xd9,
]);

async function createTestPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Test Page ${i + 1}`, { x: 50, y: 500 });
  }
  return await doc.save();
}

describe('PDF Core Operations', () => {
  describe('mergePdfs', () => {
    it('merges multiple PDF buffers into a single PDF with correct page count', async () => {
      const pdf1 = await createTestPdf(1);
      const pdf2 = await createTestPdf(2);

      const mergedBytes = await mergePdfs([pdf1, pdf2]);
      expect(mergedBytes).toBeInstanceOf(Uint8Array);
      expect(mergedBytes.byteLength).toBeGreaterThan(0);

      // Verify the resulting PDF can be loaded and has 3 pages
      const resultDoc = await PDFDocument.load(mergedBytes);
      expect(resultDoc.getPageCount()).toBe(3);

      // Verify PDF magic header
      const header = new TextDecoder().decode(mergedBytes.slice(0, 5));
      expect(header).toBe('%PDF-');
    });

    it('throws when empty array is passed to merge', async () => {
      await expect(mergePdfs([])).rejects.toThrow('No PDF files provided to merge');
    });
  });

  describe('rotatePdfPages', () => {
    it('rotates all pages clockwise by 90 degrees by default', async () => {
      const pdf = await createTestPdf(2);
      const rotatedBytes = await rotatePdfPages(pdf, { clockwise: true });

      const resultDoc = await PDFDocument.load(rotatedBytes);
      expect(resultDoc.getPageCount()).toBe(2);
      expect(resultDoc.getPage(0).getRotation().angle).toBe(90);
      expect(resultDoc.getPage(1).getRotation().angle).toBe(90);
    });

    it('rotates counterclockwise when clockwise is false', async () => {
      const pdf = await createTestPdf(1);
      const rotatedBytes = await rotatePdfPages(pdf, { clockwise: false });

      const resultDoc = await PDFDocument.load(rotatedBytes);
      expect(resultDoc.getPage(0).getRotation().angle).toBe(270);
    });

    it('rotates only selected pages when allPages is false', async () => {
      const pdf = await createTestPdf(3);
      const rotatedBytes = await rotatePdfPages(pdf, {
        allPages: false,
        pageIndices: [1], // only second page
        clockwise: true,
      });

      const resultDoc = await PDFDocument.load(rotatedBytes);
      expect(resultDoc.getPage(0).getRotation().angle).toBe(0);
      expect(resultDoc.getPage(1).getRotation().angle).toBe(90);
      expect(resultDoc.getPage(2).getRotation().angle).toBe(0);
    });
  });

  describe('removePdfPages', () => {
    it('removes specified page indices from a PDF', async () => {
      const pdf = await createTestPdf(3);
      // Remove page index 1 (second page)
      const trimmedBytes = await removePdfPages(pdf, [1]);

      const resultDoc = await PDFDocument.load(trimmedBytes);
      expect(resultDoc.getPageCount()).toBe(2);
    });

    it('removes multiple pages correctly', async () => {
      const pdf = await createTestPdf(4);
      // Remove page indices 0 and 2
      const trimmedBytes = await removePdfPages(pdf, [0, 2]);

      const resultDoc = await PDFDocument.load(trimmedBytes);
      expect(resultDoc.getPageCount()).toBe(2);
    });

    it('throws when attempting to remove all pages', async () => {
      const pdf = await createTestPdf(2);
      await expect(removePdfPages(pdf, [0, 1])).rejects.toThrow(
        'Cannot remove all pages from a PDF document'
      );
    });

    it('returns unmodified PDF when empty remove array is provided', async () => {
      const pdf = await createTestPdf(2);
      const trimmedBytes = await removePdfPages(pdf, []);

      const resultDoc = await PDFDocument.load(trimmedBytes);
      expect(resultDoc.getPageCount()).toBe(2);
    });

    describe('parseRemovePageInput', () => {
      it('rejects empty and whitespace-only input without silently removing page 1', () => {
        expect(parseRemovePageInput('', 5).error).toBeTruthy();
        expect(parseRemovePageInput('   ', 5).error).toBeTruthy();
        expect(parseRemovePageInput('', 5).indices).toEqual([]);
      });

      it('rejects non-integer, negative, or malformed inputs', () => {
        expect(parseRemovePageInput('abc', 5).error).toBeTruthy();
        expect(parseRemovePageInput('1, foo', 5).error).toBeTruthy();
        expect(parseRemovePageInput('0', 5).error).toBeTruthy();
        expect(parseRemovePageInput('-1', 5).error).toBeTruthy();
        expect(parseRemovePageInput('1-a', 5).error).toBeTruthy();
      });

      it('rejects reversed ranges such as 4-2', () => {
        const res = parseRemovePageInput('4-2', 5);
        expect(res.error).toContain('Reversed range');
        expect(res.indices).toEqual([]);
      });

      it('rejects pages exceeding the total document page count', () => {
        const res1 = parseRemovePageInput('6', 5);
        expect(res1.error).toContain('exceeds total document page count (5)');

        const res2 = parseRemovePageInput('2-7', 5);
        expect(res2.error).toContain('exceeds total document page count (5)');
      });

      it('rejects attempts to remove all pages from a document', () => {
        const resAll = parseRemovePageInput('1-5', 5);
        expect(resAll.error).toContain('Cannot remove all 5 pages');
        expect(resAll.indices).toEqual([]);

        const resSingle = parseRemovePageInput('1', 1);
        expect(resSingle.error).toContain('Cannot remove all 1 pages');
      });

      it('supports dash ranges such as 1-3', () => {
        const res = parseRemovePageInput('1-3', 5);
        expect(res.error).toBeUndefined();
        expect(res.pageNumbers).toEqual([1, 2, 3]);
        expect(res.indices).toEqual([0, 1, 2]);
        expect(res.remainingCount).toBe(2);
      });

      it('supports single pages and comma-separated combinations', () => {
        const res = parseRemovePageInput('1, 3, 5', 5);
        expect(res.error).toBeUndefined();
        expect(res.pageNumbers).toEqual([1, 3, 5]);
        expect(res.indices).toEqual([0, 2, 4]);
        expect(res.remainingCount).toBe(2);
      });

      it('supports mixed ranges and single pages', () => {
        const res = parseRemovePageInput('1-2, 4', 5);
        expect(res.error).toBeUndefined();
        expect(res.pageNumbers).toEqual([1, 2, 4]);
        expect(res.indices).toEqual([0, 1, 3]);
        expect(res.remainingCount).toBe(2);
      });

      it('deduplicates overlapping pages cleanly without crashing', () => {
        const res = parseRemovePageInput('1-3, 2, 3', 5);
        expect(res.error).toBeUndefined();
        expect(res.pageNumbers).toEqual([1, 2, 3]);
        expect(res.indices).toEqual([0, 1, 2]);
        expect(res.remainingCount).toBe(2);
      });
    });
  });

  describe('splitPdfPages', () => {
    it('splits a PDF into a single range correctly', async () => {
      const pdf = await createTestPdf(5);
      const { outputs, zipBytes } = await splitPdfPages(pdf, [{ start: 2, end: 4 }], {
        baseName: 'sample.pdf',
      });

      expect(outputs).toHaveLength(1);
      expect(outputs[0].name).toBe('sample-part-1-pages-2-4.pdf');
      expect(outputs[0].pageCount).toBe(3);
      expect(outputs[0].startPage).toBe(2);
      expect(outputs[0].endPage).toBe(4);

      const splitDoc = await PDFDocument.load(outputs[0].bytes);
      expect(splitDoc.getPageCount()).toBe(3);
      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes.byteLength).toBeGreaterThan(0);
    });

    it('splits a PDF into multiple disjoint ranges with correct page counts and names', async () => {
      const pdf = await createTestPdf(6);
      const { outputs, zipBytes } = await splitPdfPages(
        pdf,
        [
          { start: 1, end: 2 },
          { start: 3, end: 3 },
          { start: 5, end: 6 },
        ],
        { baseName: 'report.pdf' }
      );

      expect(outputs).toHaveLength(3);
      expect(outputs[0].name).toBe('report-part-1-pages-1-2.pdf');
      expect(outputs[0].pageCount).toBe(2);
      expect(outputs[1].name).toBe('report-part-2-page-3.pdf');
      expect(outputs[1].pageCount).toBe(1);
      expect(outputs[2].name).toBe('report-part-3-pages-5-6.pdf');
      expect(outputs[2].pageCount).toBe(2);

      // Verify each generated PDF is valid and has expected page count
      const doc1 = await PDFDocument.load(outputs[0].bytes);
      expect(doc1.getPageCount()).toBe(2);
      const doc2 = await PDFDocument.load(outputs[1].bytes);
      expect(doc2.getPageCount()).toBe(1);
      const doc3 = await PDFDocument.load(outputs[2].bytes);
      expect(doc3.getPageCount()).toBe(2);

      expect(zipBytes.byteLength).toBeGreaterThan(0);
    });

    it('rejects reversed ranges', async () => {
      const pdf = await createTestPdf(5);
      await expect(splitPdfPages(pdf, [{ start: 4, end: 2 }])).rejects.toThrow(
        'Reversed page range: 4-2'
      );
    });

    it('rejects out-of-bounds page ranges', async () => {
      const pdf = await createTestPdf(3);
      await expect(splitPdfPages(pdf, [{ start: 1, end: 5 }])).rejects.toThrow(
        'exceeds total document page count (3)'
      );
    });

    it('rejects overlapping ranges', async () => {
      const pdf = await createTestPdf(5);
      await expect(
        splitPdfPages(pdf, [
          { start: 1, end: 3 },
          { start: 3, end: 5 },
        ])
      ).rejects.toThrow('Overlapping page ranges detected');
    });

    it('rejects empty ranges list', async () => {
      const pdf = await createTestPdf(3);
      await expect(splitPdfPages(pdf, [])).rejects.toThrow(
        'At least one page range must be specified'
      );
    });

    it('rejects empty or corrupt PDF buffer', async () => {
      await expect(splitPdfPages(new Uint8Array(0), [{ start: 1, end: 1 }])).rejects.toThrow(
        'No PDF buffer provided'
      );
      await expect(
        splitPdfPages(new Uint8Array([1, 2, 3, 4]), [{ start: 1, end: 1 }])
      ).rejects.toThrow('Failed to load PDF document');
    });
  });

  describe('parsePageRanges', () => {
    it('parses comma-separated single and multi-page ranges correctly', () => {
      const res = parsePageRanges('1-2, 4, 6-7', 8);
      expect(res.error).toBeUndefined();
      expect(res.ranges).toEqual([
        { start: 1, end: 2 },
        { start: 4, end: 4 },
        { start: 6, end: 7 },
      ]);
      expect(res.omittedPages).toEqual([3, 5, 8]);
    });

    it('flags empty input with friendly error message', () => {
      const res = parsePageRanges('', 5);
      expect(res.error).toBe('Please enter at least one page number or range.');
    });

    it('rejects reversed range input', () => {
      const res = parsePageRanges('4-2', 5);
      expect(res.error).toContain('start page 4 is greater than end page 2');
    });

    it('rejects out-of-bounds page numbers', () => {
      const res = parsePageRanges('1-3, 9', 5);
      expect(res.error).toContain('Page number 9 exceeds total pages (5)');
    });

    it('rejects overlapping ranges and pages', () => {
      const res = parsePageRanges('1-3, 2-4', 5);
      expect(res.error).toContain('is included in more than one range');
    });

    it('rejects malformed syntax', () => {
      const res = parsePageRanges('1-2-3', 5);
      expect(res.error).toContain('Invalid range format');
    });
  });

  describe('createZip (Stored / Method 0)', () => {
    it('generates a valid ZIP archive from byte entries', () => {
      const entry1 = { name: 'test1.txt', bytes: new TextEncoder().encode('Hello') };
      const entry2 = { name: 'test2.txt', bytes: new TextEncoder().encode('World') };

      const zip = createZip([entry1, entry2]);
      expect(zip).toBeInstanceOf(Uint8Array);
      expect(zip.byteLength).toBeGreaterThan(0);

      // Verify PK local header signature (0x04034b50) at position 0
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      expect(view.getUint32(0, true)).toBe(0x04034b50);
    });

    it('calculates deterministic standard IEEE CRC32 values', () => {
      const data = new TextEncoder().encode('123456789');
      // Standard CRC-32 check value for "123456789" is 0xCBF43926
      expect(crc32(data)).toBe(0xcbf43926);
    });
  });

  describe('imagesToPdf', () => {
    it('detects image format from magic header bytes', () => {
      expect(detectImageFormat(TEST_PNG_1X1)).toBe('png');
      expect(detectImageFormat(TEST_JPEG_1X1)).toBe('jpeg');
      expect(
        detectImageFormat(
          new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
        )
      ).toBe('webp');
      expect(detectImageFormat(new Uint8Array([1, 2, 3, 4]))).toBe('unknown');
    });

    it('converts a single PNG into a 1-page PDF using Fit Image sizing', async () => {
      const pdfBytes = await imagesToPdf([
        { name: 'photo1.png', bytes: TEST_PNG_1X1 },
      ], { pageSizing: 'fit', margin: 'none' });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.byteLength).toBeGreaterThan(0);

      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBe(1);
      // Fit image with 1x1 image and 0 margin has page size 1x1
      expect(doc.getPage(0).getWidth()).toBe(1);
      expect(doc.getPage(0).getHeight()).toBe(1);
    });

    it('converts a single JPEG into a 1-page PDF', async () => {
      const pdfBytes = await imagesToPdf([
        { name: 'photo1.jpg', bytes: TEST_JPEG_1X1 },
      ], { pageSizing: 'fit', margin: 'none' });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBe(1);
    });

    it('converts multiple images preserving exact image sequence order', async () => {
      const pdfBytes = await imagesToPdf([
        { name: 'first.png', bytes: TEST_PNG_2X1 },
        { name: 'second.jpg', bytes: TEST_JPEG_1X1 },
        { name: 'third.png', bytes: TEST_PNG_1X2 },
      ], { pageSizing: 'fit', margin: 'none' });

      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBe(3);

      // Verify page dimensions match the corresponding image in order:
      // Page 1: 2x1 landscape
      expect(doc.getPage(0).getWidth()).toBe(2);
      expect(doc.getPage(0).getHeight()).toBe(1);
      // Page 2: 1x1 square
      expect(doc.getPage(1).getWidth()).toBe(1);
      expect(doc.getPage(1).getHeight()).toBe(1);
      // Page 3: 1x2 portrait
      expect(doc.getPage(2).getWidth()).toBe(1);
      expect(doc.getPage(2).getHeight()).toBe(2);
    });

    it('creates A4 pages with automatic orientation (landscape vs portrait)', async () => {
      const pdfBytes = await imagesToPdf([
        { name: 'landscape.png', bytes: TEST_PNG_2X1 }, // 2x1 -> landscape
        { name: 'portrait.png', bytes: TEST_PNG_1X2 },  // 1x2 -> portrait
      ], { pageSizing: 'a4', margin: 'none' });

      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBe(2);

      // A4 page 1 (landscape): width ~841.89, height ~595.28
      expect(doc.getPage(0).getWidth()).toBeCloseTo(841.89, 1);
      expect(doc.getPage(0).getHeight()).toBeCloseTo(595.28, 1);

      // A4 page 2 (portrait): width ~595.28, height ~841.89
      expect(doc.getPage(1).getWidth()).toBeCloseTo(595.28, 1);
      expect(doc.getPage(1).getHeight()).toBeCloseTo(841.89, 1);
    });

    it('applies margin presets correctly', async () => {
      const pdfBytes = await imagesToPdf([
        { name: 'photo.png', bytes: TEST_PNG_1X1 },
      ], { pageSizing: 'fit', margin: 'small' }); // small margin = 18 pt

      const doc = await PDFDocument.load(pdfBytes);
      // 1x1 image + 2 * 18 pt = 37 pt
      expect(doc.getPage(0).getWidth()).toBe(37);
      expect(doc.getPage(0).getHeight()).toBe(37);
    });

    it('rejects empty image array', async () => {
      await expect(imagesToPdf([])).rejects.toThrow('At least one image file is required');
    });

    it('rejects empty or zero-byte image data', async () => {
      await expect(
        imagesToPdf([{ name: 'empty.png', bytes: new Uint8Array(0) }])
      ).rejects.toThrow('Image "empty.png" has empty data.');
    });

    it('rejects unsupported or corrupt image formats', async () => {
      await expect(
        imagesToPdf([{ name: 'broken.txt', bytes: new Uint8Array([1, 2, 3, 4, 5]) }])
      ).rejects.toThrow('Unsupported or unreadable image format');
    });

    it('rejects corrupt JPEG/PNG image data during decoding', async () => {
      // Valid PNG header followed by garbage bytes
      const corruptPng = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
      ]);
      await expect(
        imagesToPdf([{ name: 'corrupted.png', bytes: corruptPng }])
      ).rejects.toThrow('Failed to decode image data for "corrupted.png"');
    });

    it('verifies output integrity using independent parser (pdfjs-dist)', async () => {
      const pdfBytes = await imagesToPdf(
        [
          { name: 'landscape.png', bytes: TEST_PNG_2X1 },
          { name: 'square.jpg', bytes: TEST_JPEG_1X1 },
          { name: 'portrait.png', bytes: TEST_PNG_1X2 },
        ],
        { pageSizing: 'fit', margin: 'none' }
      );

      // Verify with PDF.js independent reader
      const doc = await loadPdf(pdfBytes);
      expect(doc.numPages).toBe(3);

      const page1Size = await getPageSize(doc, 1);
      expect(page1Size.width).toBe(2);
      expect(page1Size.height).toBe(1);

      const page2Size = await getPageSize(doc, 2);
      expect(page2Size.width).toBe(1);
      expect(page2Size.height).toBe(1);

      const page3Size = await getPageSize(doc, 3);
      expect(page3Size.width).toBe(1);
      expect(page3Size.height).toBe(2);

      await destroyPdf(doc);
    });
  });

  describe('compressPdf', () => {
    it('compresses a PDF document while strictly preserving page count', async () => {
      const testPdf = await createTestPdf(3);
      const compressedBytes = await compressPdf(testPdf, { preset: 'balanced' });

      expect(compressedBytes).toBeInstanceOf(Uint8Array);
      expect(compressedBytes.byteLength).toBeGreaterThan(0);

      // Verify with pdf-lib
      const doc = await PDFDocument.load(compressedBytes);
      expect(doc.getPageCount()).toBe(3);

      // Verify with independent PDF reader (pdfjs-dist)
      const readerDoc = await loadPdf(compressedBytes);
      expect(readerDoc.numPages).toBe(3);
      await destroyPdf(readerDoc);
    });

    it('supports Light, Balanced, and Strong compression presets', async () => {
      const testPdf = await createTestPdf(2);

      const light = await compressPdf(testPdf, { preset: 'light' });
      const balanced = await compressPdf(testPdf, { preset: 'balanced' });
      const strong = await compressPdf(testPdf, { preset: 'strong' });

      expect((await PDFDocument.load(light)).getPageCount()).toBe(2);
      expect((await PDFDocument.load(balanced)).getPageCount()).toBe(2);
      expect((await PDFDocument.load(strong)).getPageCount()).toBe(2);
    });

    it('compresses PDF containing embedded JPEG images without corrupting visual dimensions', async () => {
      const doc = await PDFDocument.create();
      const img = await doc.embedJpg(TEST_JPEG_1X1);
      const page = doc.addPage([300, 400]);
      page.drawImage(img, { x: 50, y: 50, width: 200, height: 200 });
      const originalPdf = await doc.save();

      const compressed = await compressPdf(originalPdf, { preset: 'strong' });
      expect(compressed).toBeInstanceOf(Uint8Array);

      // Verify output with independent reader
      const readerDoc = await loadPdf(compressed);
      expect(readerDoc.numPages).toBe(1);
      const size = await getPageSize(readerDoc, 1);
      expect(size.width).toBe(300);
      expect(size.height).toBe(400);
      await destroyPdf(readerDoc);
    });

    it('never produces an output file larger than input for already-optimized PDFs', async () => {
      const testPdf = await createTestPdf(1);
      const compressed = await compressPdf(testPdf, { preset: 'light' });

      // Output should be less than or equal to original byte length
      expect(compressed.byteLength).toBeLessThanOrEqual(testPdf.byteLength);
    });

    it('rejects empty PDF buffer with a friendly error message', async () => {
      await expect(compressPdf(new Uint8Array(0))).rejects.toThrow(
        'The provided PDF file is empty.'
      );
    });

    it('rejects corrupt or malformed PDF data with an informative error', async () => {
      const corruptData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      await expect(compressPdf(corruptData)).rejects.toThrow(
        'Failed to read PDF document. The file may be corrupt or invalid.'
      );
    });

    it('compresses towards a requested target size and preserves page count', async () => {
      const testPdf = await createTestPdf(3);
      // Target size 100 KB (testPdf is ~2 KB, so target is met)
      const targetBytes = 100 * 1024;
      const compressed = await compressPdf(testPdf, { targetBytes });

      expect(compressed).toBeInstanceOf(Uint8Array);
      expect(compressed.byteLength).toBeLessThanOrEqual(targetBytes);

      const doc = await PDFDocument.load(compressed);
      expect(doc.getPageCount()).toBe(3);

      const stats = calculateCompressionStats(testPdf.byteLength, compressed.byteLength, targetBytes);
      expect(stats.targetAchieved).toBe(true);
      expect(stats.targetBytes).toBe(targetBytes);
    });

    it('terminates within bounded iterations when target size is unreachable and returns best valid output', async () => {
      const testPdf = await createTestPdf(3);
      // Impossible target size of 50 bytes for a multi-page PDF
      const impossibleTarget = 50;
      const compressed = await compressPdf(testPdf, { targetBytes: impossibleTarget });

      expect(compressed).toBeInstanceOf(Uint8Array);
      // The output must remain a valid PDF and never be inflated
      expect(compressed.byteLength).toBeLessThanOrEqual(testPdf.byteLength);

      const doc = await PDFDocument.load(compressed);
      expect(doc.getPageCount()).toBe(3);

      const stats = calculateCompressionStats(testPdf.byteLength, compressed.byteLength, impossibleTarget);
      // Confirms target was not falsely claimed
      expect(stats.targetAchieved).toBe(false);
      expect(stats.compressedSize).toBeGreaterThan(impossibleTarget);
    });

    it('calculates compression statistics correctly with target size evaluation', () => {
      // Case 1: Target achieved
      const stats1 = calculateCompressionStats(1000000, 480000, 500000);
      expect(stats1.originalSize).toBe(1000000);
      expect(stats1.compressedSize).toBe(480000);
      expect(stats1.savedBytes).toBe(520000);
      expect(stats1.savedPercent).toBe(52.0);
      expect(stats1.isAlreadyOptimized).toBe(false);
      expect(stats1.targetBytes).toBe(500000);
      expect(stats1.targetAchieved).toBe(true);

      // Case 2: Target missed
      const stats2 = calculateCompressionStats(1000000, 650000, 500000);
      expect(stats2.originalSize).toBe(1000000);
      expect(stats2.compressedSize).toBe(650000);
      expect(stats2.savedBytes).toBe(350000);
      expect(stats2.savedPercent).toBe(35.0);
      expect(stats2.targetBytes).toBe(500000);
      expect(stats2.targetAchieved).toBe(false);

      // Case 3: Already optimized / equal size
      const stats3 = calculateCompressionStats(5000, 5000);
      expect(stats3.savedBytes).toBe(0);
      expect(stats3.savedPercent).toBe(0);
      expect(stats3.isAlreadyOptimized).toBe(true);
      expect(stats3.targetAchieved).toBeUndefined();

      // Case 4: Result was slightly larger or equal (flagged as already optimized)
      const stats4 = calculateCompressionStats(5000, 5020, 4000);
      expect(stats4.savedBytes).toBe(0);
      expect(stats4.savedPercent).toBe(0);
      expect(stats4.isAlreadyOptimized).toBe(true);
      expect(stats4.targetAchieved).toBe(false);
    });
  });
});
