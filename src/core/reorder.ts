// Pure core operation for reordering pages in a PDF document.
// Zero DOM or browser dependencies: accepts typed byte array (Uint8Array) and returns transformed byte array.
import { PDFDocument } from 'pdf-lib';

export interface ReorderOptions {
  baseName?: string;
}

/**
 * Validates whether the requested page order is a valid permutation of [0, 1, ..., totalPages - 1].
 */
export function validatePageOrder(
  pageOrder: number[],
  pageCount: number
): { valid: boolean; error?: string } {
  if (pageCount <= 0) {
    return { valid: false, error: 'Document must have at least one page.' };
  }

  if (pageOrder.length !== pageCount) {
    return {
      valid: false,
      error: `Page order count (${pageOrder.length}) does not match document page count (${pageCount}).`,
    };
  }

  const seen = new Set<number>();
  for (let i = 0; i < pageOrder.length; i++) {
    const pageIndex = pageOrder[i];
    if (!Number.isInteger(pageIndex)) {
      return { valid: false, error: `Invalid page index "${pageIndex}" at position ${i + 1}.` };
    }
    if (pageIndex < 0 || pageIndex >= pageCount) {
      return {
        valid: false,
        error: `Page index ${pageIndex + 1} is out of bounds (document has ${pageCount} pages).`,
      };
    }
    if (seen.has(pageIndex)) {
      return {
        valid: false,
        error: `Duplicate page index ${pageIndex + 1} detected in reorder sequence.`,
      };
    }
    seen.add(pageIndex);
  }

  return { valid: true };
}

/**
 * Reorders pages in a PDF document according to 0-based pageOrder indices.
 */
export async function reorderPdfPages(
  buffer: Uint8Array,
  pageOrder: number[],
  _options?: ReorderOptions,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Reorder operation requires a valid PDF buffer.');
  }

  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = srcDoc.getPageCount();

  const validation = validatePageOrder(pageOrder, pageCount);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid page order specified.');
  }

  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  const newDoc = await PDFDocument.create();

  // Copy pages in the new specified order
  const copiedPages = await newDoc.copyPages(srcDoc, pageOrder);
  for (const page of copiedPages) {
    if (signal?.aborted) {
      throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
    }
    newDoc.addPage(page);
  }

  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  return await newDoc.save({ useObjectStreams: true });
}
