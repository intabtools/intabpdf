import { describe, expect, it } from 'vitest';
import { calculateFitScale } from './useViewerZoom';
import type { PageSize } from './renderPage';

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
});
