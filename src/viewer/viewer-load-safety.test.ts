import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { destroyPdf, loadPdf } from './renderPage';

describe('Viewer load safety and error handling', () => {
  it('throws a descriptive error when loading damaged or non-PDF bytes', async () => {
    const corruptBytes = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44]);
    await expect(loadPdf(corruptBytes)).rejects.toThrow();
  });

  it('successfully loads a valid PDF and releases resources upon destroy', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([200, 300]);
    const validBytes = await pdfDoc.save();

    const doc = await loadPdf(validBytes);
    expect(doc).toBeDefined();
    expect(doc.numPages).toBe(1);

    await expect(destroyPdf(doc)).resolves.toBeUndefined();
  });

  it('simulates race condition where a stale load is superseded by a newer request', async () => {
    const pdfDoc1 = await PDFDocument.create();
    pdfDoc1.addPage([100, 100]);
    const bytes1 = await pdfDoc1.save();

    const pdfDoc2 = await PDFDocument.create();
    pdfDoc2.addPage([200, 200]);
    pdfDoc2.addPage([200, 200]);
    const bytes2 = await pdfDoc2.save();

    let currentRequestId = 0;

    // Request 1 starts
    const req1 = ++currentRequestId;
    const promise1 = loadPdf(bytes1);

    // Request 2 starts immediately before request 1 completes
    const req2 = ++currentRequestId;
    const promise2 = loadPdf(bytes2);

    const [doc1, doc2] = await Promise.all([promise1, promise2]);

    // Request 1 is stale (req1 !== currentRequestId)
    expect(req1 === currentRequestId).toBe(false);
    expect(req2 === currentRequestId).toBe(true);

    // Stale doc1 must be destroyed
    await destroyPdf(doc1);

    // Only doc2 is adopted as active document
    expect(doc2.numPages).toBe(2);
    await destroyPdf(doc2);
  });
});
