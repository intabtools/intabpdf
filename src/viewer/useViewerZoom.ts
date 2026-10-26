// Custom hook managing zoom levels, fit-to-width scaling, and touch pinch-to-zoom gestures.
import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { PageSize } from './renderPage';

const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const DEFAULT_PAGE_SIZE: PageSize = { width: 595, height: 842 };

export function calculateFitScale(usableWidth: number, pageWidth: number): number {
  if (usableWidth <= 0 || pageWidth <= 0) return 1;
  const clampedWidth = Math.max(120, usableWidth);
  return Math.min(3.0, Math.max(0.15, clampedWidth / pageWidth));
}

export interface UseViewerZoomOptions {
  pageSizes: PageSize[];
  cvsWidth: number;
  scrollRootRef: RefObject<HTMLElement | null>;
  pagesWrapperRef: RefObject<HTMLDivElement | null>;
  currentPage?: number;
}

export interface UseViewerZoomResult {
  zoom: number;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  isFitToWidth: boolean;
  setIsFitToWidth: (fit: boolean | ((prev: boolean) => boolean)) => void;
  fitScale: number;
  effectiveScale: number;
  zoomIn: () => void;
  zoomOut: () => void;
  toggleFitOrZoom: () => void;
}

export function useViewerZoom({
  pageSizes,
  cvsWidth,
  scrollRootRef,
  pagesWrapperRef,
  currentPage,
}: UseViewerZoomOptions): UseViewerZoomResult {
  const [zoom, setZoom] = useState(100);
  const [isFitToWidth, setIsFitToWidth] = useState(true);

  const targetPageSize =
    (currentPage && pageSizes[currentPage - 1]) || pageSizes[0] || DEFAULT_PAGE_SIZE;
  const targetPageWidth = targetPageSize.width;
  const fitScale = calculateFitScale(cvsWidth, targetPageWidth);
  const effectiveScale = isFitToWidth ? fitScale : zoom / 100;

  const zoomOut = useCallback(() => {
    const currentPercent = Math.round(effectiveScale * 100);
    const prev = [...ZOOM_STEPS].reverse().find((step) => step < currentPercent);
    setIsFitToWidth(false);
    setZoom(prev ?? Math.max(25, currentPercent - 25));
  }, [effectiveScale]);

  const zoomIn = useCallback(() => {
    const currentPercent = Math.round(effectiveScale * 100);
    const next = ZOOM_STEPS.find((step) => step > currentPercent);
    setIsFitToWidth(false);
    setZoom(next ?? Math.min(400, currentPercent + 25));
  }, [effectiveScale]);

  const toggleFitOrZoom = useCallback(() => {
    if (isFitToWidth) {
      setIsFitToWidth(false);
      setZoom(100);
    } else {
      setIsFitToWidth(true);
    }
  }, [isFitToWidth]);

  // Real PDF Pinch-to-Zoom Gesture for Android and Touchscreens
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

    let initialDist = 0;
    let initialZoom = 100;
    let focalPoint = { x: 0, y: 0 };
    let initialScroll = { left: 0, top: 0 };
    let isPinching = false;
    let lastTargetZoom = 100;

    const getDistance = (t1: Touch, t2: Touch) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getMidpoint = (t1: Touch, t2: Touch) => {
      const rect = root.getBoundingClientRect();
      return {
        x: (t1.clientX + t2.clientX) / 2 - rect.left,
        y: (t1.clientY + t2.clientY) / 2 - rect.top,
      };
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isPinching = true;
        initialDist = getDistance(e.touches[0], e.touches[1]);
        focalPoint = getMidpoint(e.touches[0], e.touches[1]);
        initialScroll = { left: root.scrollLeft, top: root.scrollTop };
        initialZoom = isFitToWidth ? Math.round(fitScale * 100) : zoom;
        lastTargetZoom = initialZoom;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPinching || e.touches.length !== 2) return;
      e.preventDefault();

      const currentDist = getDistance(e.touches[0], e.touches[1]);
      if (initialDist < 10) return;

      const scaleFactor = currentDist / initialDist;
      const targetZoom = Math.max(25, Math.min(400, Math.round(initialZoom * scaleFactor)));
      lastTargetZoom = targetZoom;

      if (pagesWrapperRef.current) {
        const originX = focalPoint.x + initialScroll.left;
        const originY = focalPoint.y + initialScroll.top;
        pagesWrapperRef.current.style.transformOrigin = `${originX}px ${originY}px`;
        pagesWrapperRef.current.style.transform = `scale(${scaleFactor})`;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (isPinching && e.touches.length < 2) {
        isPinching = false;
        if (pagesWrapperRef.current) {
          pagesWrapperRef.current.style.transform = '';
          pagesWrapperRef.current.style.transformOrigin = '';
        }
        if (Math.abs(lastTargetZoom - initialZoom) >= 2) {
          const scaleRatio = lastTargetZoom / initialZoom;
          const targetScrollLeft = (focalPoint.x + initialScroll.left) * scaleRatio - focalPoint.x;
          const targetScrollTop = (focalPoint.y + initialScroll.top) * scaleRatio - focalPoint.y;
          setIsFitToWidth(false);
          setZoom(lastTargetZoom);
          requestAnimationFrame(() => {
            if (root) {
              root.scrollLeft = Math.max(0, targetScrollLeft);
              root.scrollTop = Math.max(0, targetScrollTop);
            }
          });
        }
      }
    };

    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [fitScale, isFitToWidth, pagesWrapperRef, scrollRootRef, zoom]);

  return {
    zoom,
    setZoom,
    isFitToWidth,
    setIsFitToWidth,
    fitScale,
    effectiveScale,
    zoomIn,
    zoomOut,
    toggleFitOrZoom,
  };
}
