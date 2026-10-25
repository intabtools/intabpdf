import { describe, expect, it } from 'vitest';

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
});
