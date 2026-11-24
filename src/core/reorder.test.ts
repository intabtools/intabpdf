import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { reorderPdfPages, validatePageOrder } from './reorder';

async function createSamplePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 400 + i * 20]);
    page.drawText(`Page Number ${i + 1}`, { x: 50, y: 300 });
  }
  return await doc.save();
}

describe('reorderPdfPages Core Operation', () => {
  it('correctly reorders pages in a 3-page document according to custom permutation', async () => {
    const pdfBytes = await createSamplePdf(3);
    // Reverse order: page 3 (index 2), page 2 (index 1), page 1 (index 0)
    const newOrder = [2, 1, 0];
    const reorderedBytes = await reorderPdfPages(pdfBytes, newOrder);

    expect(reorderedBytes).toBeInstanceOf(Uint8Array);
    expect(reorderedBytes.byteLength).toBeGreaterThan(0);

    const doc = await PDFDocument.load(reorderedBytes);
    expect(doc.getPageCount()).toBe(3);

    // Verify heights: original page 3 had height 440, page 2 had 420, page 1 had 400
    expect(doc.getPage(0).getHeight()).toBe(440);
    expect(doc.getPage(1).getHeight()).toBe(420);
    expect(doc.getPage(2).getHeight()).toBe(400);
  });

  it('correctly handles arbitrary reordering of 5 pages', async () => {
    const pdfBytes = await createSamplePdf(5);
    const newOrder = [1, 3, 0, 4, 2];
    const reorderedBytes = await reorderPdfPages(pdfBytes, newOrder);

    const doc = await PDFDocument.load(reorderedBytes);
    expect(doc.getPageCount()).toBe(5);

    expect(doc.getPage(0).getHeight()).toBe(420); // index 1
    expect(doc.getPage(1).getHeight()).toBe(460); // index 3
    expect(doc.getPage(2).getHeight()).toBe(400); // index 0
    expect(doc.getPage(3).getHeight()).toBe(480); // index 4
    expect(doc.getPage(4).getHeight()).toBe(440); // index 2
  });

  it('rejects invalid page orders with duplicate indices', async () => {
    const pdfBytes = await createSamplePdf(3);
    await expect(reorderPdfPages(pdfBytes, [0, 0, 1])).rejects.toThrow(/Duplicate page index/);
  });

  it('rejects invalid page orders with missing indices or length mismatch', async () => {
    const pdfBytes = await createSamplePdf(3);
    await expect(reorderPdfPages(pdfBytes, [0, 1])).rejects.toThrow(/does not match document page count/);
    await expect(reorderPdfPages(pdfBytes, [0, 1, 2, 3])).rejects.toThrow(/does not match document page count/);
  });

  it('rejects out of bounds page indices', async () => {
    const pdfBytes = await createSamplePdf(3);
    await expect(reorderPdfPages(pdfBytes, [0, 1, 5])).rejects.toThrow(/out of bounds/);
    await expect(reorderPdfPages(pdfBytes, [-1, 0, 1])).rejects.toThrow(/out of bounds/);
  });

  it('validatePageOrder correctly identifies valid and invalid permutations', () => {
    expect(validatePageOrder([0, 1, 2], 3).valid).toBe(true);
    expect(validatePageOrder([2, 0, 1], 3).valid).toBe(true);
    expect(validatePageOrder([0, 1], 3).valid).toBe(false);
    expect(validatePageOrder([0, 1, 1], 3).valid).toBe(false);
    expect(validatePageOrder([0, 1, 3], 3).valid).toBe(false);
    expect(validatePageOrder([], 0).valid).toBe(false);
  });

  it('aborts when signal is cancelled', async () => {
    const pdfBytes = await createSamplePdf(3);
    const controller = new AbortController();
    controller.abort(new DOMException('Operation was aborted.', 'AbortError'));

    await expect(reorderPdfPages(pdfBytes, [2, 1, 0], {}, controller.signal)).rejects.toThrow(
      'Operation was aborted.'
    );
  });
});
