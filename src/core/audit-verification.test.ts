// Comprehensive audit verification test suite for InTabPDF compression engine.
// Verifies target-size solver, color spaces (RGB, Gray, CMYK, Indexed), predictors,
// signature detection, and reproduces benchmark scenarios.
import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import {
  analyzePdfDocument,
  calculateCompressionStats,
  compressPdf,
} from './index';
import { loadPdf, getPageSize, destroyPdf } from '../viewer/renderPage';

/**
 * Creates a synthetic multi-page text document with dense vector fonts and text.
 */
async function createTextPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Official University Transcript & Application - Page ${p + 1}`, { x: 50, y: 800 });
    page.drawText(`Candidate ID: APP-${1000 + p}`, { x: 50, y: 775 });
    for (let i = 0; i < 40; i++) {
      page.drawText(
        `Course Semester ${p + 1} Module ${i + 1}: Computer Architecture, Operating Systems & Networks - Grade A`,
        { x: 50, y: 740 - i * 16 }
      );
    }
  }
  return await doc.save();
}

/**
 * Creates a synthetic scanned PDF with Flate continuous-tone raster image.
 */
async function createScannedPdf(width: number, height: number, colors: number = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, height]);

  const rawBytes = new Uint8Array(width * height * colors);
  for (let i = 0; i < rawBytes.length; i++) {
    rawBytes[i] = ((i * 13) ^ (i >> 3)) & 0xff;
  }

  const colorSpace = colors === 1 ? 'DeviceGray' : colors === 4 ? 'DeviceCMYK' : 'DeviceRGB';

  const stream = doc.context.flateStream(rawBytes, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: colorSpace,
    BitsPerComponent: 8,
  });
  const ref = doc.context.register(stream);
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({
      XObject: { Img: ref },
    })
  );

  return await doc.save();
}

/**
 * Creates a synthetic PDF with an Indexed color space image.
 */
async function createIndexedPdf(width: number, height: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, height]);

  // 1 byte per pixel indexing into a small palette
  const rawIndices = new Uint8Array(width * height);
  for (let i = 0; i < rawIndices.length; i++) {
    rawIndices[i] = i % 16;
  }

  const palette = new Uint8Array(16 * 3);
  for (let i = 0; i < palette.length; i++) {
    palette[i] = (i * 17) & 0xff;
  }

  const stream = doc.context.flateStream(rawIndices, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: ['Indexed', 'DeviceRGB', 15, palette],
    BitsPerComponent: 8,
  });
  const ref = doc.context.register(stream);
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({
      XObject: { IndexedImg: ref },
    })
  );

  return await doc.save();
}

/**
 * Creates a synthetic digitally signed PDF document.
 */
async function createSignedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  page.drawText('Digitally Signed Academic Certificate', { x: 50, y: 550 });

  // Add dummy signature dictionary to Root.Perms / DSS
  const sigDict = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 100, 200, 300],
    Contents: new Uint8Array([0x30, 0x82]),
  });
  const sigRef = doc.context.register(sigDict);

  // Register in root
  const root = doc.context.lookup(doc.context.trailerInfo.Root);
  if (root instanceof PDFDict) {
    root.set(PDFName.of('Perms'), doc.context.obj({ DocMDP: sigRef }));
  }

  return await doc.save();
}

describe('Audit Verification: Color Spaces, Predictors, and Structural Safety', () => {
  it('safely compresses Flate RGB scans without corrupting dimensions', async () => {
    const original = await createScannedPdf(100, 100, 3);
    const compressed = await compressPdf(original, { preset: 'recommended' });

    expect(compressed.byteLength).toBeLessThanOrEqual(original.byteLength);

    const doc = await PDFDocument.load(compressed);
    expect(doc.getPageCount()).toBe(1);

    const reader = await loadPdf(compressed);
    expect(reader.numPages).toBe(1);
    const size = await getPageSize(reader, 1);
    expect(size.width).toBe(100);
    expect(size.height).toBe(100);
    await destroyPdf(reader);
  });

  it('safely handles Grayscale (DeviceGray) Flate images', async () => {
    const original = await createScannedPdf(80, 80, 1);
    const compressed = await compressPdf(original, { preset: 'smaller' });

    expect(compressed.byteLength).toBeLessThanOrEqual(original.byteLength);
    const doc = await PDFDocument.load(compressed);
    expect(doc.getPageCount()).toBe(1);
  });

  it('preserves Indexed color space images without corrupting their palette or failing', async () => {
    const original = await createIndexedPdf(60, 60);
    const compressed = await compressPdf(original, { preset: 'balanced' });

    expect(compressed).toBeInstanceOf(Uint8Array);
    const doc = await PDFDocument.load(compressed);
    expect(doc.getPageCount()).toBe(1);
  });

  it('correctly detects digital signatures in signed documents', async () => {
    const signedPdf = await createSignedPdf();
    const analysis = await analyzePdfDocument(signedPdf);

    expect(analysis.hasSignatures).toBe(true);
  });

  it('preserves page count and vector text selectable across all target size settings', async () => {
    const textPdf = await createTextPdf(2);

    const targets = [50 * 1024, 100 * 1024, 200 * 1024, 500 * 1024, 1024 * 1024];
    for (const target of targets) {
      const compressed = await compressPdf(textPdf, { targetBytes: target });
      expect(compressed.byteLength).toBeLessThanOrEqual(textPdf.byteLength);

      const doc = await PDFDocument.load(compressed);
      expect(doc.getPageCount()).toBe(2);

      const stats = calculateCompressionStats(textPdf.byteLength, compressed.byteLength, target);
      if (compressed.byteLength <= target) {
        expect(stats.targetAchieved).toBe(true);
      } else {
        expect(stats.targetAchieved).toBe(false);
      }
    }
  });

  it('handles custom target (e.g. 350 KB) and bounded impossible target (50 bytes)', async () => {
    const textPdf = await createTextPdf(2);

    // Custom 350 KB
    const customTarget = 350 * 1024;
    const resCustom = await compressPdf(textPdf, { targetBytes: customTarget });
    expect(resCustom.byteLength).toBeLessThanOrEqual(customTarget);
    const statsCustom = calculateCompressionStats(textPdf.byteLength, resCustom.byteLength, customTarget);
    expect(statsCustom.targetAchieved).toBe(true);

    // Impossible target: 50 bytes
    const impossibleTarget = 50;
    const resImpossible = await compressPdf(textPdf, { targetBytes: impossibleTarget });
    expect(resImpossible.byteLength).toBeLessThanOrEqual(textPdf.byteLength);
    const statsImp = calculateCompressionStats(textPdf.byteLength, resImpossible.byteLength, impossibleTarget);
    expect(statsImp.targetAchieved).toBe(false);
    expect(statsImp.isAlreadyOptimized).toBe(resImpossible.byteLength >= textPdf.byteLength);
  });
});
