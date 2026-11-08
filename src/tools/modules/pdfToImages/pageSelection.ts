// Pure page range parser and validator for PDF to Images.

export interface PageSelectionResult {
  pages: number[];
  error?: string;
}

/**
 * Parses and validates user-specified page selection for PDF conversion.
 * 
 * Supports:
 * - Empty string or 'all' -> all document pages [1, 2, ..., totalPages]
 * - Comma-separated numbers and ranges: '1-3, 5, 7-9'
 * - Deduplicates pages while sorting in ascending order.
 * - Validates integer ranges, reversed ranges ('5-2'), and out-of-bounds pages.
 */
export function parseImagePageSelection(
  input: string,
  totalPages: number
): PageSelectionResult {
  const trimmed = input.trim();
  if (totalPages < 1) {
    return { pages: [], error: 'The document contains no valid pages.' };
  }

  if (!trimmed || trimmed.toLowerCase() === 'all') {
    const pages: number[] = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
    return { pages };
  }

  const rawSegments = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (rawSegments.length === 0) {
    return { pages: [], error: 'Please enter at least one page number or range.' };
  }

  const pageSet = new Set<number>();

  for (const segment of rawSegments) {
    if (segment.includes('-')) {
      const parts = segment.split('-').map((s) => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return {
          pages: [],
          error: `Invalid range format: "${segment}". Use format like "1-3".`,
        };
      }

      if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
        return {
          pages: [],
          error: `Page numbers must be integers in range "${segment}".`,
        };
      }

      const start = Number(parts[0]);
      const end = Number(parts[1]);

      if (start < 1) {
        return {
          pages: [],
          error: `Page numbers must be 1 or greater in range "${segment}".`,
        };
      }

      if (start > end) {
        return {
          pages: [],
          error: `Reversed range "${segment}": start page ${start} is greater than end page ${end}.`,
        };
      }

      if (end > totalPages) {
        return {
          pages: [],
          error: `Page ${end} in range "${segment}" exceeds total document pages (${totalPages}).`,
        };
      }

      for (let p = start; p <= end; p++) {
        pageSet.add(p);
      }
    } else {
      if (!/^\d+$/.test(segment)) {
        return {
          pages: [],
          error: `Invalid page number: "${segment}". Must be an integer.`,
        };
      }

      const pageNum = Number(segment);
      if (pageNum < 1) {
        return {
          pages: [],
          error: `Page number ${pageNum} must be 1 or greater.`,
        };
      }

      if (pageNum > totalPages) {
        return {
          pages: [],
          error: `Page number ${pageNum} exceeds total document pages (${totalPages}).`,
        };
      }

      pageSet.add(pageNum);
    }
  }

  const sortedPages = Array.from(pageSet).sort((a, b) => a - b);
  if (sortedPages.length === 0) {
    return { pages: [], error: 'No valid pages selected.' };
  }

  return { pages: sortedPages };
}
