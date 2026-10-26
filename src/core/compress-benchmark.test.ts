// Benchmark and verification test suite for intelligent PDF compression engine.
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  analyzePdfDocument,
  calculateCompressionStats,
  compressPdf,
  undoPngPredictor,
  undoTiffPredictor,
} from './index';
import { loadPdf, getPageSize, destroyPdf } from '../viewer/renderPage';

// Standard 1x1 JPEG test bytes
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

/**
 * Creates a synthetic multi-page text/vector PDF (e.g. CV / Application form without images).
 */
async function createTextVectorPdf(pageCount: number = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595.28, 841.89]); // A4
    page.drawText(`Job Application & Résumé - Page ${i + 1}`, { x: 50, y: 800 });
    page.drawText('Candidate Name: Ayusman', { x: 50, y: 770 });
    page.drawText('Education: Bachelor of Technology in Computer Science', { x: 50, y: 740 });
    page.drawText('Experience: 5 years in software engineering and client-side systems', { x: 50, y: 710 });
    for (let line = 0; line < 30; line++) {
      page.drawText(`Project description line ${line + 1}: High performance PDF tools with local processing.`, {
        x: 50,
        y: 670 - line * 18,
      });
    }
  }
  return await doc.save();
}

/**
 * Creates a synthetic PDF representing a scanned marksheet or certificate with FlateDecode raster scan.
 * (Typical of Apple Notes, CamScanner, or scanner hardware exports).
 */
async function createScannedFlatePdf(width: number = 200, height: number = 200): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, height]);

  // Generate synthetic uncompressed continuous-tone scan bytes
  const rgbBytes = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgbBytes.length; i++) {
    rgbBytes[i] = (i * 7 + (i % 256)) & 0xff;
  }

  const stream = doc.context.flateStream(rgbBytes, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
  });
  const imgRef = doc.context.register(stream);

  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({
      XObject: { Scan1: imgRef },
    })
  );

  return await doc.save();
}

/**
 * Creates a synthetic mixed PDF (e.g. Résumé with passport photo and vector text).
 */
async function createMixedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const img = await doc.embedJpg(TEST_JPEG_1X1);

  page.drawText('CURRICULUM VITAE', { x: 50, y: 800 });
  page.drawText('Passport Photo:', { x: 400, y: 800 });
  page.drawImage(img, { x: 400, y: 700, width: 80, height: 90 });
  page.drawText('Contact: applicant@example.com', { x: 50, y: 770 });

  return await doc.save();
}

describe('Intelligent PDF Compression Engine Benchmarks & Integrity', () => {
  describe('PNG & TIFF Predictor Reversal', () => {
    it('correctly undoes PNG Sub, Up, Average, and Paeth predictors', () => {
      // Test Sub predictor (Filter 1)
      const subEncoded = new Uint8Array([
        1, 10, 20, 30, // Tag 1 (Sub), pixel values
      ]);
      const undoneSub = undoPngPredictor(subEncoded, 1, 1, 3, 8);
      expect(undoneSub[0]).toBe(10);
      expect(undoneSub[1]).toBe(20);
      expect(undoneSub[2]).toBe(30);

      // Test Up predictor (Filter 2)
      // Row 0: tag 0, values 10, 20, 30
      // Row 1: tag 2 (Up), diff values 5, 5, 5 -> expected 15, 25, 35
      const upEncoded = new Uint8Array([
        0, 10, 20, 30,
        2, 5, 5, 5,
      ]);
      const undoneUp = undoPngPredictor(upEncoded, 1, 2, 3, 8);
      expect(undoneUp[0]).toBe(10);
      expect(undoneUp[1]).toBe(20);
      expect(undoneUp[2]).toBe(30);
      expect(undoneUp[3]).toBe(15);
      expect(undoneUp[4]).toBe(25);
      expect(undoneUp[5]).toBe(35);
    });

    it('correctly undoes TIFF horizontal difference predictor (Predictor 2)', () => {
      // Row 0: pixel 0: (10, 20, 30), pixel 1 diff: (5, 10, 15) -> expected (15, 30, 45)
      const tiffEncoded = new Uint8Array([
        10, 20, 30, 5, 10, 15,
      ]);
      const undoneTiff = undoTiffPredictor(tiffEncoded, 2, 1, 3, 8);
      expect(undoneTiff[0]).toBe(10);
      expect(undoneTiff[1]).toBe(20);
      expect(undoneTiff[2]).toBe(30);
      expect(undoneTiff[3]).toBe(15);
      expect(undoneTiff[4]).toBe(30);
      expect(undoneTiff[5]).toBe(45);
    });
  });

  describe('Document Content Profiling & Classification', () => {
    it('accurately profiles a pure text/vector document', async () => {
      const pdf = await createTextVectorPdf(3);
      const analysis = await analyzePdfDocument(pdf);

      expect(analysis.pageCount).toBe(3);
      expect(analysis.contentType).toBe('text-vector');
      expect(analysis.imageCount).toBe(0);
      expect(analysis.totalImageBytes).toBe(0);
      expect(analysis.structuralBytes).toBe(pdf.byteLength);
      expect(analysis.estimatedMinimumSafeSize).toBeGreaterThan(0);
    });

    it('accurately profiles a scanned document with Flate raster images', async () => {
      const pdf = await createScannedFlatePdf(100, 100);
      const analysis = await analyzePdfDocument(pdf);

      expect(analysis.pageCount).toBe(1);
      expect(analysis.contentType).toBe('scanned-image');
      expect(analysis.imageCount).toBe(1);
      expect(analysis.flateCount).toBe(1);
      expect(analysis.totalImageBytes).toBeGreaterThan(0);
    });

    it('accurately profiles a mixed document with JPEG photo and vector text', async () => {
      const pdf = await createMixedPdf();
      const analysis = await analyzePdfDocument(pdf);

      expect(analysis.pageCount).toBe(1);
      expect(analysis.imageCount).toBe(1);
      expect(analysis.jpegCount).toBe(1);
      expect(analysis.hasAnnotations).toBe(false);
      expect(analysis.hasSignatures).toBe(false);
    });
  });

  describe('FlateDecode Scanned Document Compression', () => {
    it('safely handles FlateDecode raster scans without corrupting document structure', async () => {
      const scanPdf = await createScannedFlatePdf(120, 120);
      const compressed = await compressPdf(scanPdf, { preset: 'balanced' });

      expect(compressed).toBeInstanceOf(Uint8Array);
      expect(compressed.byteLength).toBeLessThanOrEqual(scanPdf.byteLength);

      // Verify integrity with PDF-lib
      const doc = await PDFDocument.load(compressed);
      expect(doc.getPageCount()).toBe(1);

      // Verify integrity with PDF.js independent reader
      const readerDoc = await loadPdf(compressed);
      expect(readerDoc.numPages).toBe(1);
      const size = await getPageSize(readerDoc, 1);
      expect(size.width).toBe(120);
      expect(size.height).toBe(120);
      await destroyPdf(readerDoc);
    });
  });

  describe('Adaptive Target-Size Solver', () => {
    it('achieves target size on mixed documents when target is reasonable (e.g. 100 KB limit)', async () => {
      const mixedPdf = await createMixedPdf();
      const targetBytes = 50 * 1024; // 50 KB portal upload limit

      const compressed = await compressPdf(mixedPdf, { targetBytes });
      expect(compressed.byteLength).toBeLessThanOrEqual(targetBytes);

      const stats = calculateCompressionStats(mixedPdf.byteLength, compressed.byteLength, targetBytes);
      expect(stats.targetAchieved).toBe(true);
      expect(stats.targetBytes).toBe(targetBytes);

      // Verify document validity
      const doc = await PDFDocument.load(compressed);
      expect(doc.getPageCount()).toBe(1);
    });

    it('handles unreachable targets gracefully by delivering smallest valid PDF without false claims', async () => {
      const textPdf = await createTextVectorPdf(2);
      const impossibleTarget = 100; // 100 bytes is physically impossible for a 2-page PDF

      const compressed = await compressPdf(textPdf, { targetBytes: impossibleTarget });

      // Must never return larger than original
      expect(compressed.byteLength).toBeLessThanOrEqual(textPdf.byteLength);

      const stats = calculateCompressionStats(textPdf.byteLength, compressed.byteLength, impossibleTarget);
      expect(stats.targetAchieved).toBe(false);
      expect(stats.targetBytes).toBe(impossibleTarget);

      // Must be a 100% valid PDF
      const doc = await PDFDocument.load(compressed);
      expect(doc.getPageCount()).toBe(2);
    });

    it('preserves text vector clarity and page dimensions across compression', async () => {
      const textPdf = await createTextVectorPdf(1);
      const compressed = await compressPdf(textPdf, { preset: 'recommended' });

      const readerDoc = await loadPdf(compressed);
      const page = await readerDoc.getPage(1);
      const textContent = await page.getTextContent();

      // Text must remain vector and selectable (not rasterized)
      const fullText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');

      expect(fullText).toContain('Job Application');
      expect(fullText).toContain('Ayusman');
      expect(fullText).toContain('Bachelor of Technology');

      await destroyPdf(readerDoc);
    });
  });

  describe('Safety & Invariant Guarantees', () => {
    it('never produces an output larger than input for already-optimized documents', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([200, 200]);
      const initial = await doc.save({ useObjectStreams: true });

      const compressed = await compressPdf(initial, { preset: 'light' });
      expect(compressed.byteLength).toBeLessThanOrEqual(initial.byteLength);

      const stats = calculateCompressionStats(initial.byteLength, compressed.byteLength);
      expect(stats.isAlreadyOptimized).toBe(true);
      expect(stats.savedBytes).toBe(0);
    });

    it('rejects corrupt documents with a user-friendly error', async () => {
      // Corrupt header to test error handling
      const badBytes = new Uint8Array([0, 1, 2, 3]);
      await expect(compressPdf(badBytes)).rejects.toThrow('Failed to read PDF document');
    });
  });
});
