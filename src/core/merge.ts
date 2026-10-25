// Pure core operation for merging multiple PDF documents into a single document.
import { PDFDocument } from 'pdf-lib';

/**
 * Merge multiple PDF buffers sequentially into a single PDF document.
 */
export async function mergePdfs(
  pdfBuffers: Uint8Array[]
): Promise<Uint8Array> {
  if (pdfBuffers.length === 0) {
    throw new Error('No PDF files provided to merge.');
  }

  const mergedDoc = await PDFDocument.create();

  for (const buffer of pdfBuffers) {
    const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    for (const page of copiedPages) {
      mergedDoc.addPage(page);
    }
  }

  return await mergedDoc.save();
}
