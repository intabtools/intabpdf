// Per-document text cache for fast PDF search and zero-copy page text reuse.
import type { PdfDocument } from './renderPage';

export interface CachedPageText {
  pageNumber: number;
  items: string[];
  lowerItems: string[];
  fullLowerText: string;
}

// Keyed weakly by PdfDocument to automatically garbage collect cached text
// when a document is closed and destroyed.
const documentTextCaches = new WeakMap<PdfDocument, Map<number, CachedPageText>>();

export function getCachedPageText(
  doc: PdfDocument,
  pageNumber: number,
): CachedPageText | undefined {
  return documentTextCaches.get(doc)?.get(pageNumber);
}

export function setCachedPageText(
  doc: PdfDocument,
  pageNumber: number,
  data: CachedPageText,
): void {
  let pageMap = documentTextCaches.get(doc);
  if (!pageMap) {
    pageMap = new Map<number, CachedPageText>();
    documentTextCaches.set(doc, pageMap);
  }
  pageMap.set(pageNumber, data);
}

export function buildPageTextCache(
  pageNumber: number,
  textContentItems: Array<{ str?: string } | unknown>,
): CachedPageText {
  const items: string[] = [];
  const lowerItems: string[] = [];

  for (const item of textContentItems) {
    if (
      item &&
      typeof item === 'object' &&
      'str' in item &&
      typeof (item as { str: string }).str === 'string'
    ) {
      const s = (item as { str: string }).str;
      if (s) {
        items.push(s);
        lowerItems.push(s.toLowerCase());
      }
    }
  }

  return {
    pageNumber,
    items,
    lowerItems,
    fullLowerText: lowerItems.join(' '),
  };
}

export async function extractPageText(
  doc: PdfDocument,
  pageNumber: number,
): Promise<CachedPageText> {
  const cached = getCachedPageText(doc, pageNumber);
  if (cached) return cached;

  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const built = buildPageTextCache(pageNumber, content.items);
  setCachedPageText(doc, pageNumber, built);
  return built;
}

export function clearTextCache(doc?: PdfDocument): void {
  if (doc) {
    documentTextCaches.delete(doc);
  }
}
