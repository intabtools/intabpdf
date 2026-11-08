// Pure core operation for extracting text content from PDF documents using PDF.js infrastructure.
import { destroyPdf, loadPdf } from '../viewer/renderPage';
import { analyzePdfDocument } from './document-analysis';

export interface ExtractTextOptions {
  /**
   * If true, preserves individual line breaks as formatted in the PDF.
   * If false, joins continuous lines within the same paragraph into sentences.
   * Defaults to true.
   */
  keepLineBreaks?: boolean;
}

export interface ExtractTextResult {
  text: string;
  pageCount: number;
  wordCount: number;
  charCount: number;
  hasImages?: boolean;
}

/**
 * Formats raw PDF.js text content items into human-readable text,
 * handling line breaks, paragraph gaps, and horizontal word spacing.
 */
export function formatPageTextContent(
  items: unknown[],
  keepLineBreaks = true
): string {
  if (!items || items.length === 0) return '';

  let out = '';
  let lastY: number | null = null;
  let lastX: number | null = null;
  let lastWidth = 0;
  let approxFontSize = 12;

  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object' || !('str' in rawItem)) continue;
    const item = rawItem as { str: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean };
    const str = item.str;
    if (!str && !item.hasEOL) continue;

    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    const fontSize = item.height && item.height > 0
      ? item.height
      : Math.abs(transform[3]) || Math.abs(transform[0]) || approxFontSize;
    approxFontSize = fontSize;

    if (lastY !== null) {
      const deltaY = Math.abs(lastY - y);
      const isNewLine = deltaY >= 3 || Boolean(item.hasEOL);

      if (isNewLine) {
        const isNewParagraph = deltaY > fontSize * 1.8;
        if (keepLineBreaks) {
          out += isNewParagraph ? '\n\n' : '\n';
        } else {
          out += isNewParagraph ? '\n\n' : (out.endsWith(' ') ? '' : ' ');
        }
      } else {
        // Same line: check if we need an inter-word space
        if (lastX !== null && x > lastX + lastWidth + 2 && !out.endsWith(' ') && !str.startsWith(' ')) {
          out += ' ';
        }
      }
    }

    out += str;
    lastY = y;
    lastX = x;
    lastWidth = item.width ?? 0;
  }

  return out;
}

/**
 * Extracts plain text from a PDF buffer across all pages.
 */
export async function extractTextFromPdf(
  pdfBytes: Uint8Array,
  options: ExtractTextOptions = {}
): Promise<ExtractTextResult> {
  if (!pdfBytes || pdfBytes.byteLength === 0) {
    throw new Error('No PDF file provided for text extraction.');
  }

  const doc = await loadPdf(pdfBytes);
  try {
    const keepLineBreaks = options.keepLineBreaks !== false;
    const totalPages = doc.numPages;
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageStr = formatPageTextContent(content.items, keepLineBreaks);
      if (pageStr.trim()) {
        pageTexts.push(pageStr.trim());
      }
    }

    const fullText = pageTexts.join('\n\n');
    const trimmed = fullText.trim();
    const wordCount = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;

    let hasImages = false;
    if (wordCount === 0) {
      try {
        const analysis = await analyzePdfDocument(pdfBytes);
        hasImages = analysis.imageCount > 0;
      } catch {
        hasImages = false;
      }
    }

    return {
      text: fullText,
      pageCount: totalPages,
      wordCount,
      charCount: fullText.length,
      hasImages,
    };
  } finally {
    await destroyPdf(doc);
  }
}
