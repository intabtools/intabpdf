import { PDFDocument } from 'pdf-lib';

export interface RemovePagesOptions {
  pageIndicesToRemove: number[];
}

export interface ParsedRemovePagesResult {
  /** 0-based page indices to remove, sorted ascending */
  indices: number[];
  /** 1-based page numbers to remove, sorted ascending */
  pageNumbers: number[];
  /** Validation error message if input is invalid */
  error?: string;
  /** Number of pages that will remain in the document */
  remainingCount?: number;
}

/**
 * Parses and validates user input for page removal (e.g. "1, 3, 5-7").
 * Validates against document total pages, checks for syntax errors,
 * reversed ranges, out-of-range pages, and attempts to remove all pages.
 */
export function parseRemovePageInput(
  input: string,
  totalPages: number
): ParsedRemovePagesResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      indices: [],
      pageNumbers: [],
      error: 'Please enter at least one page number or range to remove.',
    };
  }

  if (totalPages < 1) {
    return {
      indices: [],
      pageNumbers: [],
      error: 'The document contains no valid pages.',
    };
  }

  const rawSegments = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (rawSegments.length === 0) {
    return {
      indices: [],
      pageNumbers: [],
      error: 'Please enter at least one page number or range to remove.',
    };
  }

  const pagesSet = new Set<number>();

  for (const segment of rawSegments) {
    if (segment.includes('-')) {
      const parts = segment.split('-').map((s) => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return {
          indices: [],
          pageNumbers: [],
          error: `Invalid range format: "${segment}". Use format like "1-3".`,
        };
      }

      if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
        return {
          indices: [],
          pageNumbers: [],
          error: `Page numbers must be positive integers in range "${segment}".`,
        };
      }

      const start = Number(parts[0]);
      const end = Number(parts[1]);

      if (start < 1) {
        return {
          indices: [],
          pageNumbers: [],
          error: `Page numbers must be 1 or greater in range "${segment}".`,
        };
      }

      if (start > end) {
        return {
          indices: [],
          pageNumbers: [],
          error: `Reversed range "${segment}": start page ${start} is greater than end page ${end}.`,
        };
      }

      if (end > totalPages) {
        return {
          indices: [],
          pageNumbers: [],
          error: `Page ${end} in range "${segment}" exceeds total document page count (${totalPages}).`,
        };
      }

      for (let p = start; p <= end; p++) {
        pagesSet.add(p);
      }
    } else {
      if (!/^\d+$/.test(segment)) {
        return {
          indices: [],
          pageNumbers: [],
          error: `Invalid page number: "${segment}". Must be a positive integer.`,
        };
      }

      const pageNum = Number(segment);
      if (pageNum < 1) {
        return {
          indices: [],
          pageNumbers: [],
          error: `Page number must be 1 or greater.`,
        };
      }

      if (pageNum > totalPages) {
        return {
          indices: [],
          pageNumbers: [],
          error: `Page ${pageNum} exceeds total document page count (${totalPages}).`,
        };
      }

      pagesSet.add(pageNum);
    }
  }

  if (pagesSet.size === 0) {
    return {
      indices: [],
      pageNumbers: [],
      error: 'Please enter at least one page number or range to remove.',
    };
  }

  if (pagesSet.size >= totalPages) {
    return {
      indices: [],
      pageNumbers: [],
      error: `Cannot remove all ${totalPages} pages from the document. At least one page must remain.`,
    };
  }

  const sortedPageNumbers = Array.from(pagesSet).sort((a, b) => a - b);
  const indices = sortedPageNumbers.map((p) => p - 1);

  return {
    indices,
    pageNumbers: sortedPageNumbers,
    remainingCount: totalPages - sortedPageNumbers.length,
  };
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
