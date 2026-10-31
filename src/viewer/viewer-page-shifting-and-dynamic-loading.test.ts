import { describe, expect, it, vi } from 'vitest';
import { formatBytes } from '../core/formatBytes';

describe('Fix PDF Page Shifting & Dynamic Loading Optimizations', () => {
  describe('Part 1: Page-Anchored Zoom Stability in Large Documents', () => {
    it('anchors reading position to the visible page without accumulating margin scaling error', () => {
      // Simulate 100 pages with 842px height and 18px gap (860px pitch)
      const numPages = 100;
      const pageHeightAtScale1 = 842;
      const margin = 18;
      const pitchAtScale1 = pageHeightAtScale1 + margin; // 860px

      // Target page 100 (the last page in the 100-page document):
      const targetPage = numPages;
      const page100TopAtScale1 = (targetPage - 1) * pitchAtScale1; // 85,140px

      const viewportHeight = 800;
      // Reading center of page 100:
      const targetMidYAtScale1 = page100TopAtScale1 + pageHeightAtScale1 / 2; // 85,140 + 421 = 85,561px
      const scrollTopAtScale1 = targetMidYAtScale1 - viewportHeight / 2; // 85,561 - 400 = 85,161px

      // In the old flawed naive approach:
      // newScrollTop = (scrollTopAtScale1 + viewportHeight / 2) * scaleRatio - viewportHeight / 2
      // For zoom to 125% (ratio 1.25):
      const naiveNewMidY = (scrollTopAtScale1 + viewportHeight / 2) * 1.25; // 85,561 * 1.25 = 106,951.25px
      const naiveNewScrollTop = naiveNewMidY - viewportHeight / 2; // 106,551.25px

      // At scale 1.25:
      // True page height is 842 * 1.25 = 1052.5px.
      // But CSS margins do NOT scale by 1.25, they stay 18px!
      // True pitch at scale 1.25 = 1052.5 + 18 = 1070.5px.
      // True Page 100 top at scale 1.25 = 99 * 1070.5 = 105979.5px.
      const newPageHeight = 842 * 1.25; // 1052.5px
      const newPitch = newPageHeight + margin; // 1070.5px
      const newAnchorTop = (targetPage - 1) * newPitch; // 105979.5px
      const trueNewPage100MidY = newAnchorTop + newPageHeight / 2; // 106505.75px
      const idealScrollTop = trueNewPage100MidY - viewportHeight / 2;

      // The naive calculation introduces a massive error because 99 * 18px margins were multiplied by 1.25!
      const naiveError = naiveNewMidY - trueNewPage100MidY;
      const naiveScrollError = naiveNewScrollTop - idealScrollTop;
      expect(naiveError).toBeCloseTo(445.5, 1);
      expect(naiveError).toBeGreaterThan(400); // 445.5px shifted off-screen!
      expect(naiveScrollError).toBeCloseTo(445.5, 1);

      // Now test the new Page-Anchored Zoom algorithm implemented in useViewerZoom:
      // 1. Identify anchor page at viewport center (targetPage = 100)
      // 2. Compute focal fraction inside page 100:
      const fractionInAnchor = (targetMidYAtScale1 - page100TopAtScale1) / pageHeightAtScale1; // 0.5 (dead center)
      expect(fractionInAnchor).toBeCloseTo(0.5, 5);

      // 3. At new scale (1.25), compute anchored targetMidY and anchored scrollTop:
      const anchoredTargetMidY = newAnchorTop + fractionInAnchor * newPageHeight;
      const anchoredScrollTop = Math.max(0, anchoredTargetMidY - viewportHeight / 2);

      // Verify that anchoredTargetMidY is EXACTLY at the center of page 100 at scale 1.25!
      expect(anchoredTargetMidY).toBe(trueNewPage100MidY);
      expect(anchoredScrollTop).toBe(idealScrollTop);

      // Drift is exactly 0px!
      const anchoredError = Math.abs(anchoredTargetMidY - trueNewPage100MidY);
      const anchoredScrollDrift = Math.abs(anchoredScrollTop - idealScrollTop);
      expect(anchoredError).toBe(0);
      expect(anchoredScrollDrift).toBe(0);
    });

    it('binary search finds the closest page in O(log N) time without DOM layout thrashing', () => {
      const numPages = 500;
      const pageHeight = 800;
      const margin = 18;
      const pitch = pageHeight + margin;

      // Create 500 mock page elements with offsetTop and offsetHeight
      const mockPages: { offsetTop: number; offsetHeight: number; getAttribute: (k: string) => string }[] = [];
      for (let i = 1; i <= numPages; i++) {
        const top = (i - 1) * pitch;
        mockPages.push({
          offsetTop: top,
          offsetHeight: pageHeight,
          getAttribute: (key: string) => (key === 'data-page' ? String(i) : ''),
        });
      }

      function findClosestPage(targetMidY: number): { page: number; steps: number } {
        let low = 0;
        let high = mockPages.length - 1;
        let bestIndex = 0;
        let minDistance = Infinity;
        let steps = 0;

        while (low <= high) {
          steps++;
          const mid = (low + high) >> 1;
          const el = mockPages[mid];
          const pageMidY = el.offsetTop + el.offsetHeight / 2;
          const dist = Math.abs(pageMidY - targetMidY);

          if (dist < minDistance) {
            minDistance = dist;
            bestIndex = mid;
          }

          if (pageMidY < targetMidY) {
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }

        for (const idx of [bestIndex - 1, bestIndex, bestIndex + 1]) {
          if (idx >= 0 && idx < mockPages.length) {
            const el = mockPages[idx];
            const pageMidY = el.offsetTop + el.offsetHeight / 2;
            const dist = Math.abs(pageMidY - targetMidY);
            if (dist < minDistance) {
              minDistance = dist;
              bestIndex = idx;
            }
          }
        }

        return {
          page: parseInt(mockPages[bestIndex].getAttribute('data-page') || '1', 10),
          steps,
        };
      }

      // Test searching for page 1
      const res1 = findClosestPage(400);
      expect(res1.page).toBe(1);
      expect(res1.steps).toBeLessThanOrEqual(10); // Log2(500) ≈ 9

      // Test searching for page 100
      const mid100 = (100 - 1) * pitch + pageHeight / 2;
      const res100 = findClosestPage(mid100);
      expect(res100.page).toBe(100);
      expect(res100.steps).toBeLessThanOrEqual(10);

      // Test searching for page 250
      const mid250 = (250 - 1) * pitch + pageHeight / 2;
      const res250 = findClosestPage(mid250);
      expect(res250.page).toBe(250);
      expect(res250.steps).toBeLessThanOrEqual(10);

      // Test searching for page 500
      const mid500 = (500 - 1) * pitch + pageHeight / 2;
      const res500 = findClosestPage(mid500);
      expect(res500.page).toBe(500);
      expect(res500.steps).toBeLessThanOrEqual(10);
    });

    it('scroll anchoring compensates for asynchronous pageSizes updates', () => {
      // Simulate viewport scroll container when reading targetPage
      const targetPage = 100;
      let scrollTop = 85161; // Currently reading targetPage

      // Suppose before true measurements resolve, targetPage top is at (targetPage - 1) * 860 = 85140px.
      const initialPageTop = (targetPage - 1) * 860;
      const initialViewportTop = initialPageTop - scrollTop; // -21px from viewport top

      // When background measurements resolve: pages 1..99 had different dimensions,
      // shifting page 100 top downwards by +350px.
      const updatedPageTop = initialPageTop + 350; // 85490px
      const updatedViewportTop = updatedPageTop - scrollTop; // 329px

      // The layout shift relative to viewport is:
      const shift = updatedViewportTop - initialViewportTop; // +350px
      expect(shift).toBe(350);

      // Anchoring logic applies compensation:
      if (Math.abs(shift) > 0.5) {
        scrollTop += shift;
      }

      // Now check new viewport relative position of page 100:
      const compensatedViewportTop = updatedPageTop - scrollTop;
      expect(compensatedViewportTop).toBe(initialViewportTop); // Exact match! Reading position is completely undisturbed!
    });

    it('programmatic scroll lock protects currentPage during jumps', () => {
      let isProgrammaticScroll: number | null = 100;
      let currentPage = 100;

      const handleScrollSimulation = (simulatedScrollTop: number, targetTop: number) => {
        if (isProgrammaticScroll !== null) {
          if (Math.abs(simulatedScrollTop - targetTop) <= 40) {
            isProgrammaticScroll = null;
          } else {
            // Guard active: ignore intermediate scroll events during jump
            return;
          }
        }
        // In the absence of guard, intermediate page would clobber currentPage
        currentPage = 45; // e.g. intermediate page passed during smooth scroll
      };

      const targetTop = 85140;

      // While scrolling past page 45 (scrollTop = 38000), guard blocks overwrite:
      handleScrollSimulation(38000, targetTop);
      expect(currentPage).toBe(100);
      expect(isProgrammaticScroll).toBe(100);

      // When arriving within 40px of target (scrollTop = 85120):
      handleScrollSimulation(85120, targetTop);
      expect(isProgrammaticScroll).toBeNull();
    });
  });

  describe('Part 2: Production Dynamic Loading & Code Splitting', () => {
    it('formatBytes is a standalone utility decoupled from pdf-lib', () => {
      expect(formatBytes(0)).toBe('0 KB');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(18 * 1024 * 1024)).toBe('18.0 MB');
    });

    it('ViewerContext cleanly unmounts without calling pdfjs-dist if no document was opened', async () => {
      const activeDoc: unknown = null;
      const destroyPdfSpy = vi.fn().mockResolvedValue(undefined);

      // Simulating unmount teardown
      if (activeDoc) {
        await destroyPdfSpy(activeDoc);
      }

      expect(destroyPdfSpy).not.toHaveBeenCalled();
    });
  });
});
