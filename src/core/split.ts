// Pure core PDF operation for splitting documents into distinct page ranges.
import { PDFDocument } from 'pdf-lib';
import { createZip } from './zip';

export interface PageRange {
  /** 1-based starting page index (inclusive) */
  start: number;
  /** 1-based ending page index (inclusive) */
  end: number;
}

export interface SplitOptions {
  /** Base filename for outputs (e.g. "document" -> "document-pages-1-3.pdf") */
  baseName?: string;
}

export interface SplitOutput {
  name: string;
  bytes: Uint8Array;
  startPage: number;
  endPage: number;
  pageCount: number;
}

export interface SplitPdfResult {
  outputs: SplitOutput[];
  zipBytes: Uint8Array;
}

export interface ParsedRangesResult {
  ranges: PageRange[];
  omittedPages: number[];
  error?: string;
}

/**
 * Validates an array of page ranges against a document's total page count.
 * Throws a descriptive error if ranges are empty, non-integer, reversed,
 * out-of-bounds, or overlapping.
 */
export function validatePageRanges(ranges: PageRange[], totalPages: number): void {
  if (!ranges || ranges.length === 0) {
    throw new Error('At least one page range must be specified.');
  }

  if (totalPages < 1) {
    throw new Error('Document has no valid pages to split.');
  }

  for (const r of ranges) {
    if (!Number.isInteger(r.start) || !Number.isInteger(r.end)) {
      throw new Error(`Page numbers must be integers. Received start: ${r.start}, end: ${r.end}.`);
    }

    if (r.start < 1) {
      throw new Error(`Invalid start page ${r.start}. Page numbers must be 1 or greater.`);
    }

    if (r.start > r.end) {
      throw new Error(`Reversed page range: ${r.start}-${r.end}. Start page cannot be greater than end page.`);
    }

    if (r.end > totalPages) {
      throw new Error(`Page ${r.end} exceeds total document page count (${totalPages}).`);
    }
  }

  // Check for overlapping ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].end >= sorted[i + 1].start) {
      throw new Error(
        `Overlapping page ranges detected: pages ${sorted[i].start}-${sorted[i].end} and ${sorted[i + 1].start}-${sorted[i + 1].end}. Ranges must be disjoint.`
      );
    }
  }
}

/**
 * Parses a comma-separated range string (e.g., "1-3, 5, 7-10") into validated PageRange objects.
 * Computes which document pages are omitted from the split.
 */
export function parsePageRanges(input: string, totalPages: number): ParsedRangesResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ranges: [], omittedPages: [], error: 'Please enter at least one page number or range.' };
  }

  const rawSegments = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (rawSegments.length === 0) {
    return { ranges: [], omittedPages: [], error: 'Please enter at least one valid page range.' };
  }

  const parsedRanges: PageRange[] = [];

  for (const segment of rawSegments) {
    if (segment.includes('-')) {
      const parts = segment.split('-').map((s) => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return { ranges: [], omittedPages: [], error: `Invalid range format: "${segment}". Use format like "1-3".` };
      }

      const start = Number(parts[0]);
      const end = Number(parts[1]);

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return { ranges: [], omittedPages: [], error: `Page numbers must be integers in range "${segment}".` };
      }

      if (start < 1) {
        return { ranges: [], omittedPages: [], error: `Page numbers must be 1 or greater in range "${segment}".` };
      }

      if (start > end) {
        return { ranges: [], omittedPages: [], error: `Reversed range "${segment}": start page ${start} is greater than end page ${end}.` };
      }

      if (end > totalPages) {
        return { ranges: [], omittedPages: [], error: `Page ${end} in range "${segment}" exceeds total pages (${totalPages}).` };
      }

      parsedRanges.push({ start, end });
    } else {
      const pageNum = Number(segment);
      if (!Number.isInteger(pageNum)) {
        return { ranges: [], omittedPages: [], error: `Invalid page number: "${segment}". Must be an integer.` };
      }

      if (pageNum < 1) {
        return { ranges: [], omittedPages: [], error: `Page number ${pageNum} must be 1 or greater.` };
      }

      if (pageNum > totalPages) {
        return { ranges: [], omittedPages: [], error: `Page number ${pageNum} exceeds total pages (${totalPages}).` };
      }

      parsedRanges.push({ start: pageNum, end: pageNum });
    }
  }

  // Check for duplicate / overlapping pages
  const includedPages = new Set<number>();
  for (const range of parsedRanges) {
    for (let p = range.start; p <= range.end; p++) {
      if (includedPages.has(p)) {
        return {
          ranges: [],
          omittedPages: [],
          error: `Page ${p} is included in more than one range. Ranges must be disjoint without overlapping pages.`,
        };
      }
      includedPages.add(p);
    }
  }

  // Calculate omitted pages
  const omittedPages: number[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (!includedPages.has(p)) {
      omittedPages.push(p);
    }
  }

  return { ranges: parsedRanges, omittedPages };
}

/**
 * Inspects a PDF byte buffer to determine its total page count.
 */
export async function getPdfPageCount(buffer: Uint8Array): Promise<number> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
    return doc.getPageCount();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('encrypt') || msg.toLowerCase().includes('password')) {
      throw new Error('This PDF is password-protected or encrypted. Please unlock it before splitting.', { cause: err });
    }
    throw new Error('Failed to read PDF document. The file may be corrupt or invalid.', { cause: err });
  }
}

/**
 * Splits a PDF document into one or more separate valid PDF documents according to the given ranges.
 * Packages all generated PDFs into a universally compatible ZIP archive.
 */
export async function splitPdfPages(
  buffer: Uint8Array,
  ranges: PageRange[],
  options?: SplitOptions
): Promise<SplitPdfResult> {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('No PDF buffer provided to split.');
  }

  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('encrypt') || msg.toLowerCase().includes('password')) {
      throw new Error('This PDF is password-protected or encrypted. Please unlock it before splitting.', { cause: err });
    }
    throw new Error('Failed to load PDF document. The file may be corrupt or invalid.', { cause: err });
  }

  const totalPages = srcDoc.getPageCount();
  validatePageRanges(ranges, totalPages);

  const baseName = options?.baseName ? options.baseName.replace(/\.pdf$/i, '') : 'split';
  const outputs: SplitOutput[] = [];

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const newDoc = await PDFDocument.create();

    // Collect 0-based page indices
    const pageIndices: number[] = [];
    for (let p = range.start; p <= range.end; p++) {
      pageIndices.push(p - 1);
    }

    const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach((page) => newDoc.addPage(page));

    const bytes = await newDoc.save({ useObjectStreams: true });
    const name =
      range.start === range.end
        ? `${baseName}-part-${i + 1}-page-${range.start}.pdf`
        : `${baseName}-part-${i + 1}-pages-${range.start}-${range.end}.pdf`;

    outputs.push({
      name,
      bytes,
      startPage: range.start,
      endPage: range.end,
      pageCount: pageIndices.length,
    });
  }

  // Create ZIP archive containing all split files
  const zipBytes = createZip(outputs.map((o) => ({ name: o.name, bytes: o.bytes })));

  return {
    outputs,
    zipBytes,
  };
}
