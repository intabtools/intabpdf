import { PDFDocument } from 'pdf-lib';

export interface RemovePagesOptions {
  pageIndicesToRemove: number[];
}

/**
 * Remove specified 0-based page indices from a PDF document.
 */
export async function removePdfPages(
  pdfBuffer: Uint8Array,
  pageIndicesToRemove: number[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  if (totalPages === 0) {
    throw new Error('PDF document contains no pages.');
  }

  if (pageIndicesToRemove.length === 0) {
    return await pdfDoc.save();
  }

  const toRemove = new Set(
    pageIndicesToRemove.filter((idx) => idx >= 0 && idx < totalPages)
  );

  if (toRemove.size >= totalPages) {
    throw new Error('Cannot remove all pages from a PDF document. At least one page must remain.');
  }

  // Remove from highest index to lowest so page indices do not shift during removal
  const sortedIndices = Array.from(toRemove).sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    pdfDoc.removePage(idx);
  }

  return await pdfDoc.save();
}
