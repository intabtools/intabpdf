// Pure core operation for rotating pages in a PDF document in 90-degree increments.
import { PDFDocument, degrees } from 'pdf-lib';

export interface RotateOptions {
  clockwise?: boolean;
  allPages?: boolean;
  pageIndices?: number[];
  rotationDegrees?: number;
}

export interface ParsedRotatePagesResult {
  /** 0-based page indices to rotate, sorted ascending */
  indices: number[];
  /** 1-based page numbers to rotate, sorted ascending */
  pageNumbers: number[];
  /** Validation error message if input is invalid */
  error?: string;
}

/**
 * Parses and validates user input for selective page rotation (e.g. "1, 3, 5-7").
 * Validates against document total pages, checks for syntax errors,
 * reversed ranges, and out-of-range pages.
 */
export function parseRotatePageInput(
  input: string,
  totalPages: number
): ParsedRotatePagesResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      indices: [],
      pageNumbers: [],
      error: 'Please enter at least one page number or range to rotate.',
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
      error: 'Please enter at least one page number or range to rotate.',
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
          error: 'Page number must be 1 or greater.',
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
      error: 'Please enter at least one page number or range to rotate.',
    };
  }

  const sortedPageNumbers = Array.from(pagesSet).sort((a, b) => a - b);
  const indices = sortedPageNumbers.map((p) => p - 1);

  return {
    indices,
    pageNumbers: sortedPageNumbers,
  };
}

/**
 * Rotate pages of a PDF document by 90 degrees clockwise or counterclockwise.
 */
export async function rotatePdfPages(
  pdfBuffer: Uint8Array,
  options: RotateOptions = {}
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  if (totalPages === 0) {
    throw new Error('PDF document contains no pages to rotate.');
  }

  const angleDelta =
    options.rotationDegrees !== undefined
      ? options.rotationDegrees
      : options.clockwise !== false
        ? 90
        : -90;

  const targetIndices =
    options.allPages !== false || !options.pageIndices || options.pageIndices.length === 0
      ? pdfDoc.getPageIndices()
      : options.pageIndices.filter((idx) => idx >= 0 && idx < totalPages);

  for (const idx of targetIndices) {
    const page = pdfDoc.getPage(idx);
    const currentAngle = page.getRotation().angle;
    const newAngle = ((currentAngle + angleDelta) % 360 + 360) % 360;
    page.setRotation(degrees(newAngle));
  }

  return await pdfDoc.save();
}
