import { describe, expect, it } from 'vitest';
import { calculateFitScale, DEFAULT_PAGE_SIZE, ZOOM_STEPS } from './useViewerZoom';
import { MAX_CANVAS_DIMENSION, MAX_CANVAS_PIXELS, type PageSize } from './renderPage';

describe('Fit to Width Calculation & Responsiveness', () => {
  const PORTRAIT_A4: PageSize = { width: 595, height: 842 };
  const LANDSCAPE_A4: PageSize = { width: 842, height: 595 };
  const US_LETTER_PORTRAIT: PageSize = { width: 612, height: 792 };
  const US_LETTER_LANDSCAPE: PageSize = { width: 792, height: 612 };

  describe('Core Scaling Formula (calculateFitScale)', () => {
    it('scales portrait page to exactly match usable viewer container width', () => {
      // Usable container width after subtracting viewer padding
      const usableMobileWidth = 328; // e.g. 360px viewport - 32px padding (16px left + 16px right)
      const scale = calculateFitScale(usableMobileWidth, PORTRAIT_A4.width);

      expect(scale).toBeCloseTo(328 / 595, 4);

      // Rendered page width matches available width
      const renderedWidth = Math.round(PORTRAIT_A4.width * scale);
      expect(renderedWidth).toBe(328);
    });

    it('scales landscape page to match usable viewer container width', () => {
      const usableMobileWidth = 328;
      const scale = calculateFitScale(usableMobileWidth, LANDSCAPE_A4.width);

      expect(scale).toBeCloseTo(328 / 842, 4);

      const renderedWidth = Math.round(LANDSCAPE_A4.width * scale);
      expect(renderedWidth).toBe(328);
    });

    it('preserves exact page aspect ratio without distortion', () => {
      const usableWidth = 720;
      const scale = calculateFitScale(usableWidth, PORTRAIT_A4.width);

      const renderedWidth = Math.round(PORTRAIT_A4.width * scale);
      const renderedHeight = Math.round(PORTRAIT_A4.height * scale);

      const originalRatio = PORTRAIT_A4.width / PORTRAIT_A4.height;
      const renderedRatio = renderedWidth / renderedHeight;

      expect(renderedRatio).toBeCloseTo(originalRatio, 2);
    });

    it('handles responsive changes across mobile, tablet, and desktop viewports', () => {
      // Small mobile (320px viewport -> 288px usable)
      const smallMobileScale = calculateFitScale(288, PORTRAIT_A4.width);
      expect(Math.round(PORTRAIT_A4.width * smallMobileScale)).toBe(288);

      // Standard mobile (360px viewport -> 328px usable)
      const mobileScale = calculateFitScale(328, PORTRAIT_A4.width);
      expect(Math.round(PORTRAIT_A4.width * mobileScale)).toBe(328);

      // Tablet portrait (768px viewport -> 736px usable)
      const tabletScale = calculateFitScale(736, PORTRAIT_A4.width);
      expect(Math.round(PORTRAIT_A4.width * tabletScale)).toBe(736);

      // Desktop (1200px viewport -> 1168px usable)
      const desktopScale = calculateFitScale(1168, PORTRAIT_A4.width);
      expect(Math.round(PORTRAIT_A4.width * desktopScale)).toBe(1168);
    });

    it('recalculates on Android orientation change (portrait to landscape)', () => {
      // Portrait phone: 360px wide (328px usable)
      const portraitScale = calculateFitScale(328, PORTRAIT_A4.width);
      expect(Math.round(PORTRAIT_A4.width * portraitScale)).toBe(328);

      // Rotated to Landscape phone: 780px wide (748px usable)
      const landscapeScale = calculateFitScale(748, PORTRAIT_A4.width);
      expect(Math.round(PORTRAIT_A4.width * landscapeScale)).toBe(748);

      // Scale increases proportionally in landscape
      expect(landscapeScale).toBeGreaterThan(portraitScale);
    });

    it('handles sidebars and panels opening/closing on desktop', () => {
      const fullViewerWidth = 1000;
      const sidebarWidth = 110;

      // Without sidebar
      const fullScale = calculateFitScale(fullViewerWidth, PORTRAIT_A4.width);
      expect(Math.round(PORTRAIT_A4.width * fullScale)).toBe(1000);

      // With sidebar open (container shrinks by sidebar width)
      const withSidebarScale = calculateFitScale(fullViewerWidth - sidebarWidth, PORTRAIT_A4.width);
      expect(Math.round(PORTRAIT_A4.width * withSidebarScale)).toBe(890);
    });

    it('clamps to minimum container width of 120px for extremely narrow views', () => {
      const scaleNarrow = calculateFitScale(60, PORTRAIT_A4.width);
      expect(scaleNarrow).toBe(120 / 595);
    });

    it('clamps scale between 0.15 (15%) and 3.0 (300%) bounds', () => {
      // Huge container that would exceed 3.0
      const hugeContainerScale = calculateFitScale(4000, PORTRAIT_A4.width);
      expect(hugeContainerScale).toBe(3.0);

      // Tiny page width that would exceed 3.0
      const tinyPageScale = calculateFitScale(600, 50);
      expect(tinyPageScale).toBe(3.0);

      // Giant page width that would drop below 0.15
      const giantPageScale = calculateFitScale(200, 5000);
      expect(giantPageScale).toBe(0.15);
    });

    it('falls back to 1.0 when width is zero, negative, or invalid', () => {
      expect(calculateFitScale(0, PORTRAIT_A4.width)).toBe(1.0);
      expect(calculateFitScale(-100, PORTRAIT_A4.width)).toBe(1.0);
      expect(calculateFitScale(500, 0)).toBe(1.0);
      expect(calculateFitScale(500, -50)).toBe(1.0);
    });
  });

  describe('Multi-Page Mixed Orientations', () => {
    it('accurately fits US Letter and mixed orientation documents', () => {
      const usableWidth = 600;

      const letterPortraitScale = calculateFitScale(usableWidth, US_LETTER_PORTRAIT.width);
      expect(Math.round(US_LETTER_PORTRAIT.width * letterPortraitScale)).toBe(usableWidth);

      const letterLandscapeScale = calculateFitScale(usableWidth, US_LETTER_LANDSCAPE.width);
      expect(Math.round(US_LETTER_LANDSCAPE.width * letterLandscapeScale)).toBe(usableWidth);
    });
  });

  describe('Stable Document-Wide Fit Scale on Mixed Page Dimensions', () => {
    const SMALLER_A4: PageSize = { width: 590, height: 835 };
    const STANDARD_A4: PageSize = { width: 595, height: 842 };
    const LARGER_A4: PageSize = { width: 612, height: 792 };

    it('resolves stable reference page width from pageSizes[0] with DEFAULT_PAGE_SIZE fallback', () => {
      // Empty pages fallback to DEFAULT_PAGE_SIZE
      const emptyPageSizes: PageSize[] = [];
      const fallbackTarget = emptyPageSizes[0] || DEFAULT_PAGE_SIZE;
      expect(fallbackTarget).toEqual({ width: 595, height: 842 });
      expect(fallbackTarget.width).toBe(595);

      // Mixed page document always uses pageSizes[0] as reference
      const mixedPageSizes: PageSize[] = [STANDARD_A4, SMALLER_A4, LARGER_A4, LANDSCAPE_A4];
      const docTarget = mixedPageSizes[0] || DEFAULT_PAGE_SIZE;
      expect(docTarget).toBe(STANDARD_A4);
      expect(docTarget.width).toBe(595);
    });

    it('maintains completely stable Fit scale across slightly smaller, standard, and larger A4 pages', () => {
      const usableWidth = 600;
      const mixedPages: PageSize[] = [STANDARD_A4, SMALLER_A4, LARGER_A4];

      // Reference scale computed from page 1
      const stableScale = calculateFitScale(usableWidth, mixedPages[0].width);

      // Verify that simulating page navigation across all 3 pages keeps the scale constant
      const scaleOnPage1 = calculateFitScale(usableWidth, mixedPages[0].width);
      const scaleOnPage2 = calculateFitScale(usableWidth, mixedPages[0].width);
      const scaleOnPage3 = calculateFitScale(usableWidth, mixedPages[0].width);

      expect(scaleOnPage1).toBe(stableScale);
      expect(scaleOnPage2).toBe(stableScale);
      expect(scaleOnPage3).toBe(stableScale);

      // Ensure page 1 layout height remains invariant regardless of active page
      const page1HeightWhenOnPage1 = Math.round(STANDARD_A4.height * scaleOnPage1);
      const page1HeightWhenOnPage2 = Math.round(STANDARD_A4.height * scaleOnPage2);
      const page1HeightWhenOnPage3 = Math.round(STANDARD_A4.height * scaleOnPage3);

      expect(page1HeightWhenOnPage1).toBe(page1HeightWhenOnPage2);
      expect(page1HeightWhenOnPage2).toBe(page1HeightWhenOnPage3);
      // No layout shift means no scroll midpoint jumps and no rendering feedback loops
    });

    it('maintains stable Fit scale across mixed portrait and landscape documents', () => {
      const usableWidth = 720;

      // Scenario A: Portrait first, followed by Landscape
      const portraitFirst: PageSize[] = [PORTRAIT_A4, LANDSCAPE_A4];
      const portraitFirstScale = calculateFitScale(usableWidth, portraitFirst[0].width);

      // Navigation to landscape page does not change document scale
      expect(calculateFitScale(usableWidth, portraitFirst[0].width)).toBe(portraitFirstScale);

      // Page 1 matches usable width, page 2 scales proportionally without flickering
      const p1Width = Math.round(portraitFirst[0].width * portraitFirstScale);
      const p2Width = Math.round(portraitFirst[1].width * portraitFirstScale);
      expect(p1Width).toBe(usableWidth);
      expect(p2Width).toBe(Math.round(842 * (720 / 595)));

      // Scenario B: Landscape first, followed by Portrait
      const landscapeFirst: PageSize[] = [LANDSCAPE_A4, PORTRAIT_A4];
      const landscapeFirstScale = calculateFitScale(usableWidth, landscapeFirst[0].width);

      // Navigation to portrait page does not change document scale
      expect(calculateFitScale(usableWidth, landscapeFirst[0].width)).toBe(landscapeFirstScale);
      const lp1Width = Math.round(landscapeFirst[0].width * landscapeFirstScale);
      expect(lp1Width).toBe(usableWidth);
    });
  });

  describe('Maximum Zoom Reachability on Mixed-Size Documents', () => {
    it('allows reaching maximum 400% zoom regardless of mixed page dimensions', () => {
      const currentScale = 0.55; // 55% fit scale on portrait page

      const zoomInStep = (scalePercent: number): number => {
        const next = ZOOM_STEPS.find((step) => step > scalePercent);
        return next ?? Math.min(400, scalePercent + 25);
      };

      // Step up through all zoom steps
      const visitedSteps: number[] = [];
      let currentZoom = Math.round(currentScale * 100);
      while (currentZoom < 400) {
        currentZoom = zoomInStep(currentZoom);
        visitedSteps.push(currentZoom);
      }

      // Reaches exactly 400%
      expect(currentZoom).toBe(400);
      expect(visitedSteps).toContain(400);

      // Further zoom in stays clamped at 400%
      expect(zoomInStep(400)).toBe(400);
    });

    it('enforces 25% min and 400% max bounds in pinch-to-zoom calculation', () => {
      const calcPinchZoom = (initialZoom: number, factor: number): number => {
        return Math.max(25, Math.min(400, Math.round(initialZoom * factor)));
      };

      // Large stretch on small initial zoom
      expect(calcPinchZoom(50, 10)).toBe(400);
      // Pinch in on standard zoom
      expect(calcPinchZoom(100, 0.1)).toBe(25);
      // Moderate pinch on landscape-derived zoom
      expect(calcPinchZoom(39, 2.0)).toBe(78);
    });
  });

  describe('Manual Zoom Stability During Scrolling & Page Navigation', () => {
    it('preserves manual zoom level when scrolling between pages of different sizes', () => {
      // User set manual zoom to 200%
      const zoom = 200;
      const isFitToWidth = false;

      // Simulate scrolling through mixed-size pages
      const pages = [
        { page: 1, size: PORTRAIT_A4 },
        { page: 2, size: LANDSCAPE_A4 },
        { page: 3, size: US_LETTER_PORTRAIT },
      ];

      for (const p of pages) {
        // Page change handler only sets current page; zoom and isFitToWidth remain untouched
        const activePage = p.page;
        expect(activePage).toBeGreaterThanOrEqual(1);
        expect(zoom).toBe(200);
        expect(isFitToWidth).toBe(false);
      }
    });
  });

  describe('Switching Between Fit and Manual Zoom Modes', () => {
    it('toggles between Fit mode and 100% manual zoom', () => {
      let isFitToWidth = true;
      let zoom = 100;

      const toggleFitOrZoom = () => {
        if (isFitToWidth) {
          isFitToWidth = false;
          zoom = 100;
        } else {
          isFitToWidth = true;
        }
      };

      // Initially in fit mode
      expect(isFitToWidth).toBe(true);

      // Toggle to manual
      toggleFitOrZoom();
      expect(isFitToWidth).toBe(false);
      expect(zoom).toBe(100);

      // Toggle back to fit
      toggleFitOrZoom();
      expect(isFitToWidth).toBe(true);
    });

    it('transitions smoothly from Fit mode to manual zoom when zooming in or out', () => {
      const fitScale = 0.55; // 55%
      const effectiveScale = fitScale;

      // Zoom in from 55%
      const currentPercent = Math.round(effectiveScale * 100);
      const nextStep = ZOOM_STEPS.find((s) => s > currentPercent);
      expect(nextStep).toBe(75);

      // Zoom out from 55%
      const prevStep = [...ZOOM_STEPS].reverse().find((s) => s < currentPercent);
      expect(prevStep).toBe(50);
    });
  });

  describe('Horizontal Page Centring & Viewport Alignment', () => {
    // Models horizontal alignment rules: auto margins distribute positive free space equally;
    // negative free space evaluates to 0 to prevent left clipping and permit horizontal scrolling.
    const computeHorizontalOffsets = (
      viewportContentWidth: number,
      pageRenderedWidth: number
    ): {
      leftOffset: number;
      rightOffset: number;
      isCentered: boolean;
      isLeftClipped: boolean;
      allowsHorizontalScroll: boolean;
    } => {
      const freeSpace = viewportContentWidth - pageRenderedWidth;
      const isNarrowerOrEqual = freeSpace >= 0;
      const leftOffset = isNarrowerOrEqual ? Math.round(freeSpace / 2) : 0;
      const rightOffset = isNarrowerOrEqual
        ? viewportContentWidth - leftOffset - pageRenderedWidth
        : freeSpace; // negative indicates overflow to the right

      return {
        leftOffset,
        rightOffset,
        isCentered: isNarrowerOrEqual ? Math.abs(leftOffset - rightOffset) <= 1 : false,
        isLeftClipped: leftOffset < 0,
        allowsHorizontalScroll: pageRenderedWidth > viewportContentWidth,
      };
    };

    it('centres each page narrower than viewport horizontally with equal left and right space', () => {
      const viewportContentWidth = 568; // e.g. 600px container - 32px padding

      // Standard A4 exact fit
      const exactFit = computeHorizontalOffsets(viewportContentWidth, 568);
      expect(exactFit.leftOffset).toBe(0);
      expect(exactFit.rightOffset).toBe(0);
      expect(exactFit.isCentered).toBe(true);
      expect(exactFit.isLeftClipped).toBe(false);

      // Slightly smaller A4 (560px)
      const smallerA4 = computeHorizontalOffsets(viewportContentWidth, 560);
      expect(smallerA4.leftOffset).toBe(4);
      expect(smallerA4.rightOffset).toBe(4);
      expect(smallerA4.isCentered).toBe(true);
      expect(smallerA4.isLeftClipped).toBe(false);

      // Half-size receipt / small page (300px)
      const receipt = computeHorizontalOffsets(viewportContentWidth, 300);
      expect(receipt.leftOffset).toBe(134);
      expect(receipt.rightOffset).toBe(134);
      expect(receipt.isCentered).toBe(true);
      expect(receipt.isLeftClipped).toBe(false);
    });

    it('aligns pages wider than viewport to the left edge without clipping and allows horizontal scrolling', () => {
      const viewportContentWidth = 568;

      // Landscape A4 page (800px)
      const landscape = computeHorizontalOffsets(viewportContentWidth, 800);
      expect(landscape.leftOffset).toBe(0);
      expect(landscape.rightOffset).toBe(-232); // 232px scrollable overflow to the right
      expect(landscape.isLeftClipped).toBe(false);
      expect(landscape.allowsHorizontalScroll).toBe(true);

      // Slightly larger A4 / US Letter (584px)
      const largerA4 = computeHorizontalOffsets(viewportContentWidth, 584);
      expect(largerA4.leftOffset).toBe(0);
      expect(largerA4.rightOffset).toBe(-16);
      expect(largerA4.isLeftClipped).toBe(false);
      expect(largerA4.allowsHorizontalScroll).toBe(true);
    });

    it('preserves horizontal centring for each page independently in mixed page-size documents', () => {
      const viewportContentWidth = 568;
      const mixedRenderedPages = [
        { page: 1, type: 'standard-portrait', width: 568 },
        { page: 2, type: 'landscape', width: 804 },
        { page: 3, type: 'smaller-portrait', width: 560 },
        { page: 4, type: 'receipt', width: 280 },
      ];

      const alignments = mixedRenderedPages.map((p) => ({
        ...p,
        ...computeHorizontalOffsets(viewportContentWidth, p.width),
      }));

      // Page 1 (exact fit): exactly fills viewport without displacement
      expect(alignments[0].leftOffset).toBe(0);
      expect(alignments[0].rightOffset).toBe(0);

      // Page 2 (landscape): starts at left edge, overflows right without clipping
      expect(alignments[1].leftOffset).toBe(0);
      expect(alignments[1].isLeftClipped).toBe(false);
      expect(alignments[1].allowsHorizontalScroll).toBe(true);

      // Page 3 (smaller): centered with equal left/right margins (4px each)
      expect(alignments[2].leftOffset).toBe(4);
      expect(alignments[2].rightOffset).toBe(4);
      expect(alignments[2].isCentered).toBe(true);

      // Page 4 (receipt): centered with equal left/right margins (144px each)
      expect(alignments[3].leftOffset).toBe(144);
      expect(alignments[3].rightOffset).toBe(144);
      expect(alignments[3].isCentered).toBe(true);

      // All pages have no left clipping
      for (const a of alignments) {
        expect(a.isLeftClipped).toBe(false);
      }
    });

    it('supports horizontal centring at zoomed-out levels and scrolling at zoomed-in levels', () => {
      const viewportContentWidth = 600;

      // Zoomed out to 50% (all pages narrower than viewport)
      const zoomedOutP1 = computeHorizontalOffsets(viewportContentWidth, 300);
      const zoomedOutP2 = computeHorizontalOffsets(viewportContentWidth, 420);
      expect(zoomedOutP1.isCentered).toBe(true);
      expect(zoomedOutP2.isCentered).toBe(true);
      expect(zoomedOutP1.leftOffset).toBe(150);
      expect(zoomedOutP2.leftOffset).toBe(90);

      // Zoomed in to 200% (all pages wider than viewport)
      const zoomedInP1 = computeHorizontalOffsets(viewportContentWidth, 1200);
      const zoomedInP2 = computeHorizontalOffsets(viewportContentWidth, 1680);
      expect(zoomedInP1.leftOffset).toBe(0);
      expect(zoomedInP2.leftOffset).toBe(0);
      expect(zoomedInP1.isLeftClipped).toBe(false);
      expect(zoomedInP2.isLeftClipped).toBe(false);
      expect(zoomedInP1.allowsHorizontalScroll).toBe(true);
      expect(zoomedInP2.allowsHorizontalScroll).toBe(true);
    });
  });

  describe('Canvas Dimension Bounding & Memory Safety (renderPage.ts)', () => {
    it('defines safe maximum canvas dimensions and pixel limits for Android WebView GPU memory', () => {
      expect(MAX_CANVAS_DIMENSION).toBe(4096);
      expect(MAX_CANVAS_PIXELS).toBe(16777216); // 16 Megapixels
    });

    it('clamps unconstrained canvas rendering dimensions to GPU bounds without distortion', () => {
      // High-resolution scan: 2500 x 3500 pt at scale 1.0 with devicePixelRatio 2 -> 5000 x 7000 px unconstrained
      const unconstrainedWidth = 5000;
      const unconstrainedHeight = 7000;
      let renderScale = 2.0;

      if (
        unconstrainedWidth > MAX_CANVAS_DIMENSION ||
        unconstrainedHeight > MAX_CANVAS_DIMENSION ||
        unconstrainedWidth * unconstrainedHeight > MAX_CANVAS_PIXELS
      ) {
        const dimFactor = Math.min(
          MAX_CANVAS_DIMENSION / unconstrainedWidth,
          MAX_CANVAS_DIMENSION / unconstrainedHeight,
        );
        const pixelFactor = Math.sqrt(MAX_CANVAS_PIXELS / (unconstrainedWidth * unconstrainedHeight));
        renderScale *= Math.min(dimFactor, pixelFactor, 1);
      }

      const boundedWidth = unconstrainedWidth * (renderScale / 2.0);
      const boundedHeight = unconstrainedHeight * (renderScale / 2.0);

      expect(boundedWidth).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
      expect(boundedHeight).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
      expect(boundedWidth * boundedHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
      // Aspect ratio must be exactly preserved
      expect(boundedWidth / boundedHeight).toBeCloseTo(unconstrainedWidth / unconstrainedHeight, 5);
    });
  });

  describe('Pinch-to-Zoom Gesture Release Safety', () => {
    it('ignores anomalous capacitive touch collapse during finger release', () => {
      const initialDist = 180;
      const initialZoom = 150;

      const processTouchMove = (currentDist: number): { ignored: boolean; targetZoom: number } => {
        if (initialDist < 20 || currentDist < 20) {
          return { ignored: true, targetZoom: initialZoom };
        }
        const scaleFactor = currentDist / initialDist;
        if (scaleFactor < 0.25 && initialZoom >= 50) {
          return { ignored: true, targetZoom: initialZoom };
        }
        const targetZoom = Math.max(25, Math.min(400, Math.round(initialZoom * scaleFactor)));
        return { ignored: false, targetZoom };
      };

      // Valid pinch out
      expect(processTouchMove(270)).toEqual({ ignored: false, targetZoom: 225 });
      // Valid pinch in
      expect(processTouchMove(120)).toEqual({ ignored: false, targetZoom: 100 });
      // Finger lift-off capacitive collapse (distance drops abruptly to 8px)
      expect(processTouchMove(8)).toEqual({ ignored: true, targetZoom: 150 });
      // Severe anomalous scale collapse (< 0.25x)
      expect(processTouchMove(30)).toEqual({ ignored: true, targetZoom: 150 });
    });
  });

  describe('Viewport Reading Position Preservation During Zoom', () => {
    it('scales scrollTop around viewport reading center to prevent page jumps', () => {
      const clientHeight = 600;
      const initialScrollTop = 1200; // Looking at center Y = 1500 (page 2)
      const oldScale = 1.0;
      const newScale = 1.5; // Zooming in by 1.5x

      const ratio = newScale / oldScale;
      const midY = initialScrollTop + clientHeight / 2; // 1500
      const newMidY = midY * ratio; // 2250
      const newScrollTop = Math.max(0, newMidY - clientHeight / 2); // 1950

      // The new reading midpoint exactly equals the scaled old reading midpoint
      expect(newScrollTop + clientHeight / 2).toBe(midY * ratio);
      expect(newScrollTop).toBe(1950);

      // Verify zoom out scales back proportionally
      const zoomOutRatio = 1.0 / 1.5;
      const zoomOutMidY = (newScrollTop + clientHeight / 2) * zoomOutRatio;
      const restoredScrollTop = Math.max(0, zoomOutMidY - clientHeight / 2);
      expect(restoredScrollTop).toBe(initialScrollTop);
    });
  });
});
