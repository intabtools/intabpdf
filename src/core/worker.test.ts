import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { pdfProcessingService } from './worker/service';

async function createTestPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Worker Test Page ${i + 1}`, { x: 50, y: 500 });
  }
  return await doc.save();
}

describe('PdfProcessingService (Worker & Fallback Dispatcher)', () => {
  it('executes merge operation and returns merged PDF bytes', async () => {
    const pdf1 = await createTestPdf(1);
    const pdf2 = await createTestPdf(2);

    const mergedBytes = await pdfProcessingService.execute('merge', {
      buffers: [pdf1, pdf2],
    });

    expect(mergedBytes).toBeInstanceOf(Uint8Array);
    const doc = await PDFDocument.load(mergedBytes);
    expect(doc.getPageCount()).toBe(3);
  });

  it('executes rotate operation and returns rotated PDF bytes', async () => {
    const pdf = await createTestPdf(2);

    const rotatedBytes = await pdfProcessingService.execute('rotate', {
      buffer: pdf,
      options: { clockwise: true },
    });

    expect(rotatedBytes).toBeInstanceOf(Uint8Array);
    const doc = await PDFDocument.load(rotatedBytes);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  it('executes remove-pages operation and returns modified PDF bytes', async () => {
    const pdf = await createTestPdf(3);

    const resultBytes = await pdfProcessingService.execute('remove-pages', {
      buffer: pdf,
      pageIndices: [1], // remove page index 1 (page 2)
    });

    expect(resultBytes).toBeInstanceOf(Uint8Array);
    const doc = await PDFDocument.load(resultBytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('executes split operation and returns zip archive bytes', async () => {
    const pdf = await createTestPdf(4);

    const zipBytes = await pdfProcessingService.execute('split', {
      buffer: pdf,
      ranges: [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ],
      splitOptions: { baseName: 'document.pdf' },
    });

    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.byteLength).toBeGreaterThan(0);

    // Verify ZIP magic signature (0x04034b50)
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
  });

  it('executes images-to-pdf operation and returns generated PDF bytes', async () => {
    // 1x1 PNG bytes
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const pdfBytes = await pdfProcessingService.execute('images-to-pdf', {
      images: [
        { name: 'photo1.png', bytes: pngBytes },
        { name: 'photo2.png', bytes: pngBytes },
      ],
      options: { pageSizing: 'fit', margin: 'none' },
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('correctly passes A4 page sizing and margin options through pdfProcessingService', async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const pdfBytes = await pdfProcessingService.execute('images-to-pdf', {
      images: [{ name: 'doc-page.png', bytes: pngBytes }],
      options: { pageSizing: 'a4', margin: 'small' },
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
  });

  it('handles corrupt image errors and clears pending state without freezing', async () => {
    const corruptBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    await expect(
      pdfProcessingService.execute('images-to-pdf', {
        images: [{ name: 'bad.png', bytes: corruptBytes }],
      })
    ).rejects.toThrow();

    // Verify service is still operational after an error
    const validPdf = await createTestPdf(1);
    const rotated = await pdfProcessingService.execute('rotate', {
      buffer: validPdf,
      options: { clockwise: true },
    });
    expect(rotated.byteLength).toBeGreaterThan(0);
  });

  it('preserves the caller input buffers so they are not detached or neutered', async () => {
    const pdf = await createTestPdf(2);
    const originalLength = pdf.byteLength;

    await pdfProcessingService.execute('rotate', {
      buffer: pdf,
      options: { clockwise: true },
    });

    // Verify the caller's buffer remains intact and can be reused
    expect(pdf.byteLength).toBe(originalLength);
    expect(pdf.byteLength).toBeGreaterThan(0);

    // Should succeed on second execution with same buffer
    const secondResult = await pdfProcessingService.execute('rotate', {
      buffer: pdf,
      options: { clockwise: true },
    });
    expect(secondResult.byteLength).toBeGreaterThan(0);
  });

  it('executes compress operation and returns valid compressed PDF bytes', async () => {
    const pdf = await createTestPdf(3);

    const compressed = await pdfProcessingService.execute('compress', {
      buffer: pdf,
      options: { preset: 'balanced', downsampleImages: true, stripMetadata: true },
    });

    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.byteLength).toBeGreaterThan(0);

    const doc = await PDFDocument.load(compressed);
    expect(doc.getPageCount()).toBe(3);
  });

  it('executes compress operation with targetBytes through worker service', async () => {
    const pdf = await createTestPdf(2);

    const compressed = await pdfProcessingService.execute('compress', {
      buffer: pdf,
      options: { targetBytes: 500 * 1024 },
    });

    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.byteLength).toBeGreaterThan(0);

    const doc = await PDFDocument.load(compressed);
    expect(doc.getPageCount()).toBe(2);
  });

  it('cleanly terminates worker resources without errors', () => {
    expect(() => pdfProcessingService.terminateWorker()).not.toThrow();
  });
});
