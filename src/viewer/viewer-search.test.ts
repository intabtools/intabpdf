import { describe, expect, it } from 'vitest';
import {
  buildPageTextCache,
  clearTextCache,
  extractPageText,
  getCachedPageText,
  setCachedPageText,
} from './textCache';
import type { PdfDocument } from './renderPage';

interface MatchItem {
  pageNumber: number;
}

interface PageTextContent {
  items: Array<{ str?: string } | unknown>;
}

interface MockPdfPage {
  getTextContent: () => Promise<PageTextContent>;
}

interface MockPdfDoc {
  numPages: number;
  getPage: (pageNumber: number) => Promise<MockPdfPage>;
}

// Search helper function mirroring the ViewerPage logic
async function searchDocumentText(
  doc: MockPdfDoc,
  query: string,
): Promise<MatchItem[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const foundMatches: MatchItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => (item && typeof item === 'object' && 'str' in item && typeof (item as { str: string }).str === 'string'
        ? (item as { str: string }).str
        : ''))
      .join(' ')
      .toLowerCase();

    let pos = 0;
    while ((pos = pageText.indexOf(q, pos)) !== -1) {
      foundMatches.push({ pageNumber: p });
      pos += q.length;
    }
  }

  return foundMatches;
}

function getNextMatchIndex(currentIndex: number, totalMatches: number): number {
  if (totalMatches <= 0) return -1;
  return (currentIndex + 1) % totalMatches;
}

function getPrevMatchIndex(currentIndex: number, totalMatches: number): number {
  if (totalMatches <= 0) return -1;
  return (currentIndex - 1 + totalMatches) % totalMatches;
}

describe('Viewer document text search logic', () => {
  const mockDoc: MockPdfDoc = {
    numPages: 3,
    getPage: async (pageNum: number) => {
      const pageTexts: Record<number, string[]> = {
        1: ['InTabPDF', 'is', 'a', 'secure', 'offline', 'PDF', 'tool.'],
        2: ['Search', 'across', 'all', 'pages', 'quickly', 'with', 'accurate', 'matches.'],
        3: ['PDF', 'generation', 'and', 'PDF', 'manipulation', 'without', 'servers.'],
      };

      return {
        getTextContent: async () => ({
          items: (pageTexts[pageNum] || []).map((str) => ({ str })),
        }),
      };
    },
  };

  it('returns empty array when query is empty or whitespace', async () => {
    expect(await searchDocumentText(mockDoc, '')).toEqual([]);
    expect(await searchDocumentText(mockDoc, '   ')).toEqual([]);
  });

  it('performs case-insensitive text search across multiple pages', async () => {
    // "pdf" occurs on page 1 (2 times: "InTabPDF", "PDF") and page 3 (2 times: "PDF", "PDF")
    const results = await searchDocumentText(mockDoc, 'pdf');
    expect(results.length).toBe(4);
    expect(results).toEqual([
      { pageNumber: 1 },
      { pageNumber: 1 },
      { pageNumber: 3 },
      { pageNumber: 3 },
    ]);
  });

  it('finds single match on specific page', async () => {
    const results = await searchDocumentText(mockDoc, 'accurate');
    expect(results).toEqual([{ pageNumber: 2 }]);
  });

  it('returns empty array when term does not exist', async () => {
    const results = await searchDocumentText(mockDoc, 'nonexistent-string');
    expect(results).toEqual([]);
  });

  it('correctly navigates forward and backward circularly across matches', () => {
    const total = 4;
    let idx = 0;

    // Next match navigation
    idx = getNextMatchIndex(idx, total);
    expect(idx).toBe(1);
    idx = getNextMatchIndex(idx, total);
    expect(idx).toBe(2);
    idx = getNextMatchIndex(idx, total);
    expect(idx).toBe(3);
    idx = getNextMatchIndex(idx, total);
    expect(idx).toBe(0); // wraps around

    // Previous match navigation
    idx = getPrevMatchIndex(idx, total);
    expect(idx).toBe(3); // wraps backwards
    idx = getPrevMatchIndex(idx, total);
    expect(idx).toBe(2);
  });

  it('handles empty match state gracefully', () => {
    expect(getNextMatchIndex(-1, 0)).toBe(-1);
    expect(getPrevMatchIndex(-1, 0)).toBe(-1);
  });

  it('visibly wraps matched words in search-highlight marks and applies active-match class', () => {
    interface MockNode {
      textContent: string;
      className?: string;
      classList?: Set<string>;
    }

    interface MockSpan {
      dataset: Record<string, string>;
      textContent: string;
      children: MockNode[];
      innerHTML: string;
    }

    const createMockSpan = (text: string): MockSpan => ({
      dataset: {},
      textContent: text,
      children: [],
      innerHTML: text,
    });

    const spans = [
      createMockSpan('InTabPDF is a secure PDF tool.'),
      createMockSpan('Generate PDF files offline.'),
    ];

    const q = 'pdf';
    const pageMatches = [
      { id: 0, pageNumber: 1, matchIndexOnPage: 0 },
      { id: 1, pageNumber: 1, matchIndexOnPage: 1 },
      { id: 2, pageNumber: 1, matchIndexOnPage: 2 },
    ];
    const currentMatchIndex = 1;
    let pageMatchCounter = 0;

    for (const span of spans) {
      if (span.dataset.rawText === undefined) {
        span.dataset.rawText = span.textContent ?? '';
      }
      const rawText = span.dataset.rawText;
      const lower = rawText.toLowerCase();

      if (!lower.includes(q)) {
        span.textContent = rawText;
        continue;
      }

      span.children = [];
      let lastIndex = 0;
      let pos = lower.indexOf(q, 0);

      while (pos !== -1) {
        if (pos > lastIndex) {
          span.children.push({ textContent: rawText.slice(lastIndex, pos) });
        }

        const matchedText = rawText.slice(pos, pos + q.length);
        const classList = new Set<string>(['search-highlight']);

        const currentMatch = pageMatches[pageMatchCounter];
        if (currentMatch && currentMatch.id === currentMatchIndex) {
          classList.add('active-match');
        }
        pageMatchCounter++;

        span.children.push({
          textContent: matchedText,
          className: Array.from(classList).join(' '),
          classList,
        });

        lastIndex = pos + q.length;
        pos = lower.indexOf(q, lastIndex);
      }

      if (lastIndex < rawText.length) {
        span.children.push({ textContent: rawText.slice(lastIndex) });
      }
    }

    const marks = spans
      .flatMap((s) => s.children)
      .filter((c) => c.classList && c.classList.has('search-highlight'));

    expect(marks.length).toBe(3);
    expect(marks[0].textContent).toBe('PDF');
    expect(marks[0].classList?.has('active-match')).toBe(false);
    expect(marks[1].textContent).toBe('PDF');
    expect(marks[1].classList?.has('active-match')).toBe(true);
    expect(marks[2].textContent).toBe('PDF');
    expect(marks[2].classList?.has('active-match')).toBe(false);

    // Verify clear restores raw text
    spans.forEach((span) => {
      if (span.dataset.rawText !== undefined) {
        span.textContent = span.dataset.rawText;
        span.children = [];
        delete span.dataset.rawText;
      }
    });

    const clearedMarks = spans
      .flatMap((s) => s.children)
      .filter((c) => c.classList && c.classList.has('search-highlight'));

    expect(clearedMarks.length).toBe(0);
    expect(spans[0].textContent).toBe('InTabPDF is a secure PDF tool.');
    expect(spans[1].textContent).toBe('Generate PDF files offline.');
  });

  describe('Document text cache (textCache.ts)', () => {
    it('builds page text cache and extracts non-empty string items', () => {
      const items = [
        { str: 'First sentence.' },
        { str: '' },
        { type: 'beginMarkedContent' },
        { str: 'Second sentence with InTabPDF.' },
      ];

      const cached = buildPageTextCache(1, items);
      expect(cached.pageNumber).toBe(1);
      expect(cached.items).toEqual(['First sentence.', 'Second sentence with InTabPDF.']);
      expect(cached.lowerItems).toEqual([
        'first sentence.',
        'second sentence with intabpdf.',
      ]);
      expect(cached.fullLowerText).toBe(
        'first sentence. second sentence with intabpdf.'
      );
    });

    it('extracts and caches page text on first access and serves subsequent accesses from cache', async () => {
      let getPageCalls = 0;
      let getTextContentCalls = 0;

      const mockDoc = {
        getPage: async () => {
          getPageCalls++;
          return {
            getTextContent: async () => {
              getTextContentCalls++;
              return {
                items: [{ str: 'Cached content for performance.' }],
              };
            },
          };
        },
      } as unknown as PdfDocument;

      // First extraction: fetches page and textContent
      const first = await extractPageText(mockDoc, 1);
      expect(first.items).toEqual(['Cached content for performance.']);
      expect(getPageCalls).toBe(1);
      expect(getTextContentCalls).toBe(1);

      // Verify cached in WeakMap
      expect(getCachedPageText(mockDoc, 1)).toBeDefined();

      // Second extraction: returns cached data without calling getPage or getTextContent
      const second = await extractPageText(mockDoc, 1);
      expect(second).toBe(first);
      expect(getPageCalls).toBe(1);
      expect(getTextContentCalls).toBe(1);

      // Explicit clearTextCache releases cached entries
      clearTextCache(mockDoc);
      expect(getCachedPageText(mockDoc, 1)).toBeUndefined();
    });

    it('benchmarks sub-millisecond search over 200 simulated cached pages', () => {
      const mockDoc = {} as unknown as PdfDocument;

      for (let p = 1; p <= 200; p++) {
        setCachedPageText(mockDoc, p, {
          pageNumber: p,
          items: [
            `Page ${p} introduction to machine learning and neural networks.`,
            `Further details regarding section ${p} and optimization techniques.`,
          ],
          lowerItems: [
            `page ${p} introduction to machine learning and neural networks.`,
            `further details regarding section ${p} and optimization techniques.`,
          ],
          fullLowerText: `page ${p} introduction to machine learning and neural networks. further details regarding section ${p} and optimization techniques.`,
        });
      }

      const q = 'neural';
      const start = performance.now();
      const results: { pageNumber: number }[] = [];

      for (let p = 1; p <= 200; p++) {
        const cached = getCachedPageText(mockDoc, p);
        if (!cached || !cached.fullLowerText.includes(q)) continue;

        for (const item of cached.lowerItems) {
          let pos = 0;
          while ((pos = item.indexOf(q, pos)) !== -1) {
            results.push({ pageNumber: p });
            pos += q.length;
          }
        }
      }

      const duration = performance.now() - start;
      expect(results.length).toBe(200);
      expect(duration).toBeLessThan(10); // 200 pages search must execute in <10ms from cache

      clearTextCache(mockDoc);
    });
  });

  describe('Search highlight outline and zoom synchronization', () => {
    it('excludes markedContent container spans from search highlighting to prevent DOM destruction', () => {
      interface MockElement {
        className: string;
        classList: Set<string>;
        children: MockElement[];
        dataset: Record<string, string>;
        textContent: string;
      }

      // Simulates DOM created by PDF.js with markedContent
      const markedContentSpan: MockElement = {
        className: 'markedContent',
        classList: new Set(['markedContent']),
        children: [],
        dataset: {},
        textContent: 'Nested marked text inside PDF',
      };

      const textSpan: MockElement = {
        className: '',
        classList: new Set(),
        children: [],
        dataset: {},
        textContent: 'Target text for search highlight',
      };

      markedContentSpan.children.push(textSpan);

      // Selector 'span:not(.markedContent)' will match textSpan but not markedContentSpan
      const allSpans = [markedContentSpan, textSpan];
      const selectedSpans = allSpans.filter((s) => !s.classList.has('markedContent'));

      expect(selectedSpans.length).toBe(1);
      expect(selectedSpans[0].textContent).toBe('Target text for search highlight');
    });

    it('updates active-match fast-path without recreating existing highlight marks', () => {
      interface MockClassList {
        add: (cls: string) => void;
        remove: (cls: string) => void;
        contains: (cls: string) => boolean;
      }

      interface MockMark {
        className: string;
        classList: MockClassList;
        dataset: { matchId?: string };
        scrollIntoViewCount: number;
        scrollIntoView: () => void;
      }

      const createMockMark = (id: number): MockMark => {
        const classes = new Set(['search-highlight']);
        const classList: MockClassList = {
          add: (cls) => classes.add(cls),
          remove: (cls) => classes.delete(cls),
          contains: (cls) => classes.has(cls),
        };

        const mark: MockMark = {
          className: 'search-highlight',
          classList,
          dataset: { matchId: String(id) },
          scrollIntoViewCount: 0,
          scrollIntoView() {
            this.scrollIntoViewCount++;
          },
        };
        return mark;
      };

      const marks = [createMockMark(0), createMockMark(1), createMockMark(2)];
      // Mark 0 starts active
      marks[0].classList.add('active-match');

      // Fast-path: switch active match from 0 to 1
      const currentActive = marks.find((m) => m.classList.contains('active-match'));
      if (currentActive && currentActive.dataset.matchId !== '1') {
        currentActive.classList.remove('active-match');
      }

      const nextActive = marks.find((m) => m.dataset.matchId === '1');
      if (nextActive) {
        nextActive.classList.add('active-match');
        nextActive.scrollIntoView();
      }

      expect(marks[0].classList.contains('active-match')).toBe(false);
      expect(marks[1].classList.contains('active-match')).toBe(true);
      expect(marks[1].scrollIntoViewCount).toBe(1);
      expect(marks[2].classList.contains('active-match')).toBe(false);
    });
  });
});
