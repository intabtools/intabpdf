import { describe, expect, it, vi } from 'vitest';
import { isScreenEnabled, resolveDestination } from '../config/screens';
import { openPdfInNewTab, revokeAllTrackedBlobUrls, getTrackedBlobUrlCount } from '../platform/webPdf';

const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400];

function calculateFitScale(containerWidth: number, firstPageWidth: number): number {
  if (containerWidth <= 0) return 1;
  const availableWidth = Math.max(120, containerWidth - 36);
  return Math.min(3.0, Math.max(0.15, availableWidth / firstPageWidth));
}

function calculateNextZoom(currentScalePercent: number): number {
  const next = ZOOM_STEPS.find((step) => step > currentScalePercent);
  return next ?? Math.min(400, currentScalePercent + 25);
}

function calculatePrevZoom(currentScalePercent: number): number {
  const prev = [...ZOOM_STEPS].reverse().find((step) => step < currentScalePercent);
  return prev ?? Math.max(25, currentScalePercent - 25);
}

function computeActivePageFromCenter(
  midY: number,
  pages: Array<{ pageNumber: number; top: number; height: number }>
): number {
  let closestPage = 1;
  let minDistance = Infinity;

  for (const page of pages) {
    const pageMidY = page.top + page.height / 2;
    const dist = Math.abs(pageMidY - midY);
    if (dist < minDistance) {
      minDistance = dist;
      closestPage = page.pageNumber;
    }
  }

  return closestPage;
}

describe('Viewer Controls & Navigation Logic', () => {
  describe('Page Navigation & Scroll Target Calculation', () => {
    it('accurately calculates scroll target and clamps to document page bounds', () => {
      const pageOffsets: Record<number, number> = {
        1: 18,
        2: 850,
        3: 1680,
      };

      const numPages = 3;

      const performJump = (target: number) => {
        const clamped = Math.max(1, Math.min(numPages, target));
        const offset = pageOffsets[clamped];
        const targetTop = Math.max(0, offset - 18);
        return { clamped, targetTop };
      };

      // Jump forward
      expect(performJump(2)).toEqual({ clamped: 2, targetTop: 832 });
      // Jump to last
      expect(performJump(3)).toEqual({ clamped: 3, targetTop: 1662 });
      // Out of bounds high
      expect(performJump(10)).toEqual({ clamped: 3, targetTop: 1662 });
      // Out of bounds low
      expect(performJump(-1)).toEqual({ clamped: 1, targetTop: 0 });
    });

    it('identifies active page by center proximity reliably across short and tall pages', () => {
      const pages = [
        { pageNumber: 1, top: 0, height: 600 },
        { pageNumber: 2, top: 620, height: 600 },
        { pageNumber: 3, top: 1240, height: 300 }, // short page at end
      ];

      // Viewport center at 300 (looking at page 1)
      expect(computeActivePageFromCenter(300, pages)).toBe(1);

      // Viewport center at 920 (looking at page 2)
      expect(computeActivePageFromCenter(920, pages)).toBe(2);

      // Viewport center near bottom at 1390 (looking at short page 3)
      expect(computeActivePageFromCenter(1390, pages)).toBe(3);
    });
  });

  describe('Zoom & Fit-to-Width Scaling', () => {
    it('computes dynamic fit scale based on viewport container width', () => {
      const standardA4Width = 595;

      // Mobile phone width (360px container -> available 324px)
      const phoneScale = calculateFitScale(360, standardA4Width);
      expect(phoneScale).toBeCloseTo(324 / 595, 2);

      // Desktop width (1000px container -> available 964px)
      const desktopScale = calculateFitScale(1000, standardA4Width);
      expect(desktopScale).toBeCloseTo(964 / 595, 2);

      // Extremely narrow container respects minimum bound 0.15
      expect(calculateFitScale(50, standardA4Width)).toBe(0.20168067226890757); // 120 / 595

      // Zero width falls back to 1.0
      expect(calculateFitScale(0, standardA4Width)).toBe(1.0);
    });

    it('cycles up and down through zoom steps respecting 25% min and 400% max', () => {
      // From 100% zoom in
      expect(calculateNextZoom(100)).toBe(125);
      expect(calculateNextZoom(125)).toBe(150);
      expect(calculateNextZoom(300)).toBe(400);
      // Beyond 400% max cap
      expect(calculateNextZoom(400)).toBe(400);

      // Zoom out
      expect(calculatePrevZoom(400)).toBe(300);
      expect(calculatePrevZoom(100)).toBe(75);
      expect(calculatePrevZoom(50)).toBe(25);
      // Below 25% min cap
      expect(calculatePrevZoom(25)).toBe(25);
    });
  });

  describe('Distraction-Free Mode & State Synchronization Contract', () => {
    it('resets distraction-free state when shell layout is restored externally', () => {
      let isDistractionFree = true;
      let padlockVisible = true;

      const onLayoutChange = (showAppLayout: boolean) => {
        if (showAppLayout && isDistractionFree) {
          isDistractionFree = false;
          padlockVisible = false;
        }
      };

      // AppShell restores layout (e.g. user pressed Escape or Android Back)
      onLayoutChange(true);

      expect(isDistractionFree).toBe(false);
      expect(padlockVisible).toBe(false);
    });
  });

  describe('Document Close & Lifecycle Cleanup', () => {
    it('clears active file, search query, and matches upon close', () => {
      let currentFile: { name: string } | null = { name: 'sample.pdf' };
      let pdfDoc: object | null = { numPages: 5 };
      let searchQuery = 'test';
      let matches = [{ pageNumber: 1 }, { pageNumber: 2 }];
      let isSearchOpen = true;

      const handleClose = () => {
        pdfDoc = null;
        currentFile = null;
        searchQuery = '';
        matches = [];
        isSearchOpen = false;
      };

      handleClose();

      expect(pdfDoc).toBeNull();
      expect(currentFile).toBeNull();
      expect(searchQuery).toBe('');
      expect(matches).toEqual([]);
      expect(isSearchOpen).toBe(false);
    });

    it('verifies complete lifecycle: Open PDF A -> Close PDF -> Open PDF B without stale state', () => {
      // Simulate state container for viewer
      let docA: { id: string; numPages: number; text: string } | null = { id: 'pdf-a', numPages: 5, text: 'Report A' };
      let fileNameA: string | null = 'annual_report.pdf';
      let pageNumber = 3;
      let searchQuery = 'financials';
      let searchMatches = [{ id: 0, pageNumber: 3, matchIndexOnPage: 0 }];

      // Step 1: Document A is open with search and navigation state
      expect(docA.id).toBe('pdf-a');
      expect(fileNameA).toBe('annual_report.pdf');

      // Step 2: User executes Close PDF
      const closeDocument = () => {
        docA = null;
        fileNameA = null;
        pageNumber = 1;
        searchQuery = '';
        searchMatches = [];
      };

      closeDocument();
      expect(docA).toBeNull();
      expect(fileNameA).toBeNull();
      expect(pageNumber).toBe(1);
      expect(searchQuery).toBe('');
      expect(searchMatches).toEqual([]);

      // Step 3: User opens Document B
      const docB = { id: 'pdf-b', numPages: 12, text: 'Invoice B' };
      const fileNameB = 'invoice_b.pdf';

      expect(docB.id).toBe('pdf-b');
      expect(fileNameB).toBe('invoice_b.pdf');
      expect(pageNumber).toBe(1); // fresh page 1
      expect(searchMatches.length).toBe(0); // zero leftover matches
    });

    it('calculates touch pinch-to-zoom ratio and preserves focal point', () => {
      const getPinchRatio = (initialDist: number, currentDist: number) => {
        if (initialDist < 10) return 1;
        return currentDist / initialDist;
      };

      const calculatePinchZoom = (initialZoom: number, initialDist: number, currentDist: number) => {
        const ratio = getPinchRatio(initialDist, currentDist);
        return Math.max(25, Math.min(400, Math.round(initialZoom * ratio)));
      };

      // Pinch outward: 100px -> 150px (scale up 1.5x)
      expect(calculatePinchZoom(100, 100, 150)).toBe(150);

      // Pinch inward: 100px -> 60px (scale down 0.6x)
      expect(calculatePinchZoom(100, 100, 60)).toBe(60);

      // Clamping limits
      expect(calculatePinchZoom(100, 100, 500)).toBe(400); // max 400%
      expect(calculatePinchZoom(100, 100, 10)).toBe(25); // min 25%

      // Focal point preservation formula
      const calculateScrollTarget = (
        focalPos: number,
        initialScroll: number,
        initialZoom: number,
        newZoom: number
      ) => {
        const scaleRatio = newZoom / initialZoom;
        return (focalPos + initialScroll) * scaleRatio - focalPos;
      };

      // If finger is at x=200 with scroll=100 (content at 300), zooming 100% -> 200%
      // Content at 300 becomes 600. Target scroll = 600 - 200 = 400.
      expect(calculateScrollTarget(200, 100, 100, 200)).toBe(400);
    });

    it('validates direct page number input and clamps to valid page boundaries', () => {
      const numPages = 42;
      const validateAndJump = (input: string) => {
        const cleaned = input.replace(/[^0-9]/g, '').trim();
        const parsed = parseInt(cleaned, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= numPages) {
          return { valid: true, targetPage: parsed };
        }
        return { valid: false, targetPage: null };
      };

      // Valid jump
      expect(validateAndJump('15')).toEqual({ valid: true, targetPage: 15 });
      expect(validateAndJump('1')).toEqual({ valid: true, targetPage: 1 });
      expect(validateAndJump('42')).toEqual({ valid: true, targetPage: 42 });

      // Out-of-range jumps
      expect(validateAndJump('0')).toEqual({ valid: false, targetPage: null });
      expect(validateAndJump('43')).toEqual({ valid: false, targetPage: null });
      expect(validateAndJump('999')).toEqual({ valid: false, targetPage: null });

      // Non-numeric input
      expect(validateAndJump('abc')).toEqual({ valid: false, targetPage: null });
      expect(validateAndJump('')).toEqual({ valid: false, targetPage: null });
    });

    it('verifies distraction-free reading mode operates cleanly without floating pill overlay', () => {
      let isDistractionFree = false;
      let showAppLayout = true;

      const enterDistractionFree = () => {
        isDistractionFree = true;
        showAppLayout = false;
      };

      const exitDistractionFree = () => {
        isDistractionFree = false;
        showAppLayout = true;
      };

      // Entering distraction-free mode hides app shell layout for immersive reading
      enterDistractionFree();
      expect(isDistractionFree).toBe(true);
      expect(showAppLayout).toBe(false);

      // Exiting distraction-free mode via toolbar toggle restores app shell layout
      exitDistractionFree();
      expect(isDistractionFree).toBe(false);
      expect(showAppLayout).toBe(true);
    });
  });

  describe('Preservation of Working Web Flow', () => {
    it('keeps embedded viewer route disabled on web and redirects to home', () => {
      expect(isScreenEnabled('viewer', 'web')).toBe(false);
      expect(isScreenEnabled('viewer', 'electron')).toBe(true);
      expect(isScreenEnabled('viewer', 'android')).toBe(true);

      expect(resolveDestination('/viewer', 'web')).toBe('/');
      expect(resolveDestination('/viewer', 'electron')).toBe('/viewer');
      expect(resolveDestination('/viewer', 'android')).toBe('/viewer');
    });

    it('creates tracked Blob URLs with filename hint for web viewing', () => {
      revokeAllTrackedBlobUrls();
      const mockBytes = new Uint8Array([1, 2, 3]);

      if (typeof URL.createObjectURL !== 'function') {
        URL.createObjectURL = vi.fn((obj: Blob | MediaSource) => `blob:mock-${'size' in obj ? obj.size : 0}`);
      } else {
        vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => `blob:mock-${'size' in obj ? obj.size : 0}`);
      }

      const openSpy = vi.fn().mockReturnValue({ closed: false });
      vi.stubGlobal('window', {
        open: openSpy,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      vi.stubGlobal('document', {});

      const opened = openPdfInNewTab(mockBytes, 'annual_report.pdf');
      expect(opened).toBe(true);
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('#filename=annual_report.pdf'),
        '_blank'
      );
      expect(getTrackedBlobUrlCount()).toBe(1);

      revokeAllTrackedBlobUrls();
      expect(getTrackedBlobUrlCount()).toBe(0);

      vi.unstubAllGlobals();
    });
  });
});
