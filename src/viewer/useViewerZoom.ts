// Custom hook managing zoom levels, fit-to-width scaling, and touch pinch-to-zoom gestures.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PageSize } from './renderPage';

export const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
export const DEFAULT_PAGE_SIZE: PageSize = { width: 595, height: 842 };

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
  initialZoom?: number;
  initialIsFitToWidth?: boolean;
  onZoomChange?: (zoom: number, isFitToWidth: boolean) => void;
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
  initialZoom = 100,
  initialIsFitToWidth = true,
  onZoomChange,
}: UseViewerZoomOptions): UseViewerZoomResult {
  const [zoom, setZoomState] = useState(initialZoom);
  const [isFitToWidth, setIsFitToWidthState] = useState(initialIsFitToWidth);

  const targetPageSize = pageSizes[0] || DEFAULT_PAGE_SIZE;
  const targetPageWidth = targetPageSize.width;
  const fitScale = calculateFitScale(cvsWidth, targetPageWidth);
  const effectiveScale = isFitToWidth ? fitScale : zoom / 100;

  const effectiveScaleRef = useRef(effectiveScale);
  const isFitToWidthRef = useRef(isFitToWidth);
  const fitScaleRef = useRef(fitScale);
  const zoomRef = useRef(zoom);

  const onZoomChangeRef = useRef(onZoomChange);
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  const setZoom = useCallback((zoomOrUpdater: number | ((prev: number) => number)) => {
    setZoomState((prev) => {
      const next = typeof zoomOrUpdater === 'function' ? zoomOrUpdater(prev) : zoomOrUpdater;
      onZoomChangeRef.current?.(next, isFitToWidthRef.current);
      return next;
    });
  }, []);

  const setIsFitToWidth = useCallback((fitOrUpdater: boolean | ((prev: boolean) => boolean)) => {
    setIsFitToWidthState((prev) => {
      const next = typeof fitOrUpdater === 'function' ? fitOrUpdater(prev) : fitOrUpdater;
      onZoomChangeRef.current?.(zoomRef.current, next);
      return next;
    });
  }, []);

  useEffect(() => {
    effectiveScaleRef.current = effectiveScale;
    isFitToWidthRef.current = isFitToWidth;
    fitScaleRef.current = fitScale;
    zoomRef.current = zoom;
  }, [effectiveScale, isFitToWidth, fitScale, zoom]);

  // Preserve viewport reading position across zoom transitions using page-anchored positioning
  const adjustScrollForScale = useCallback(
    (newScale: number, oldScale: number) => {
      const root = scrollRootRef.current;
      if (!root || oldScale <= 0 || newScale <= 0) return;

      const pageEls = root.querySelectorAll<HTMLElement>('.pg-item[data-page]');
      const len = pageEls.length;
      if (len === 0) return;

      const targetMidY = root.scrollTop + root.clientHeight / 2;

      let low = 0;
      let high = len - 1;
      let bestIndex = 0;
      let minDistance = Infinity;

      while (low <= high) {
        const mid = (low + high) >> 1;
        const el = pageEls[mid];
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
        if (idx >= 0 && idx < len) {
          const el = pageEls[idx];
          const pageMidY = el.offsetTop + el.offsetHeight / 2;
          const dist = Math.abs(pageMidY - targetMidY);
          if (dist < minDistance) {
            minDistance = dist;
            bestIndex = idx;
          }
        }
      }

      const anchorEl = pageEls[bestIndex];
      const anchorPageNum = parseInt(anchorEl.getAttribute('data-page') || '1', 10);
      const focalOffsetInAnchor = targetMidY - anchorEl.offsetTop;
      const fractionInAnchor = anchorEl.offsetHeight > 0 ? focalOffsetInAnchor / anchorEl.offsetHeight : 0.5;

      // Coordinate adjustment after DOM elements update at new scale
      requestAnimationFrame(() => {
        const newRoot = scrollRootRef.current;
        if (!newRoot) return;
        const newAnchorEl = newRoot.querySelector<HTMLElement>(`[data-page="${anchorPageNum}"]`);
        if (newAnchorEl) {
          const newAnchorTop = newAnchorEl.offsetTop;
          const newAnchorHeight = newAnchorEl.offsetHeight;
          const newTargetMidY = newAnchorTop + fractionInAnchor * newAnchorHeight;
          newRoot.scrollTop = Math.max(0, newTargetMidY - newRoot.clientHeight / 2);
        }
      });
    },
    [scrollRootRef],
  );

  const zoomOut = useCallback(() => {
    const currentPercent = Math.round(effectiveScale * 100);
    const prev = [...ZOOM_STEPS].reverse().find((step) => step < currentPercent);
    const targetZoom = prev ?? Math.max(25, currentPercent - 25);
    const newScale = targetZoom / 100;
    adjustScrollForScale(newScale, effectiveScale);
    setIsFitToWidth(false);
    setZoom(targetZoom);
    const root = scrollRootRef.current;
    if (root && root.scrollWidth <= root.clientWidth + 2) {
      root.scrollLeft = 0;
    }
  }, [effectiveScale, adjustScrollForScale, scrollRootRef, setIsFitToWidth, setZoom]);

  const zoomIn = useCallback(() => {
    const currentPercent = Math.round(effectiveScale * 100);
    const next = ZOOM_STEPS.find((step) => step > currentPercent);
    const targetZoom = next ?? Math.min(400, currentPercent + 25);
    const newScale = targetZoom / 100;
    adjustScrollForScale(newScale, effectiveScale);
    setIsFitToWidth(false);
    setZoom(targetZoom);
  }, [effectiveScale, adjustScrollForScale, setIsFitToWidth, setZoom]);

  const toggleFitOrZoom = useCallback(() => {
    const root = scrollRootRef.current;
    if (isFitToWidth) {
      const newScale = 1.0;
      adjustScrollForScale(newScale, effectiveScale);
      setIsFitToWidth(false);
      setZoom(100);
    } else {
      adjustScrollForScale(fitScale, effectiveScale);
      setIsFitToWidth(true);
      if (root) {
        root.scrollLeft = 0;
      }
    }
  }, [isFitToWidth, effectiveScale, fitScale, adjustScrollForScale, scrollRootRef, setIsFitToWidth, setZoom]);

  // Real PDF Pinch-to-Zoom Gesture for Android and Touchscreens
  const gestureRef = useRef({
    initialDist: 0,
    initialZoom: 100,
    focalPoint: { x: 0, y: 0 },
    initialScroll: { left: 0, top: 0 },
    isPinching: false,
    lastTargetZoom: 100,
  });

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

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
        const d = getDistance(e.touches[0], e.touches[1]);
        if (d < 15) return;
        const gesture = gestureRef.current;
        gesture.isPinching = true;
        gesture.initialDist = d;
        gesture.focalPoint = getMidpoint(e.touches[0], e.touches[1]);
        gesture.initialScroll = { left: root.scrollLeft, top: root.scrollTop };
        gesture.initialZoom = isFitToWidthRef.current
          ? Math.round(fitScaleRef.current * 100)
          : zoomRef.current;
        gesture.lastTargetZoom = gesture.initialZoom;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.isPinching || e.touches.length !== 2) return;
      e.preventDefault();

      const currentDist = getDistance(e.touches[0], e.touches[1]);
      if (gesture.initialDist < 20 || currentDist < 20) return;

      const scaleFactor = currentDist / gesture.initialDist;
      // Guard against anomalous capacitive touch collapse while lifting fingers
      if (scaleFactor < 0.25 && gesture.initialZoom >= 50) return;

      const targetZoom = Math.max(25, Math.min(400, Math.round(gesture.initialZoom * scaleFactor)));
      gesture.lastTargetZoom = targetZoom;

      if (pagesWrapperRef.current) {
        const originX = gesture.focalPoint.x + gesture.initialScroll.left;
        const originY = gesture.focalPoint.y + gesture.initialScroll.top;
        pagesWrapperRef.current.style.transformOrigin = `${originX}px ${originY}px`;
        pagesWrapperRef.current.style.transform = `scale(${scaleFactor})`;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (gesture.isPinching && e.touches.length < 2) {
        gesture.isPinching = false;
        if (pagesWrapperRef.current) {
          pagesWrapperRef.current.style.transform = '';
          pagesWrapperRef.current.style.transformOrigin = '';
        }
        const committedZoom = gesture.lastTargetZoom;
        const baseZoom = gesture.initialZoom;

        if (Math.abs(committedZoom - baseZoom) >= 2) {
          const focalY = gesture.focalPoint.y + gesture.initialScroll.top;
          const pageEls = root.querySelectorAll<HTMLElement>('.pg-item[data-page]');
          const len = pageEls.length;
          let anchorPageNum = 1;
          let fractionY = 0.5;

          if (len > 0) {
            let low = 0;
            let high = len - 1;
            let bestIndex = 0;
            let minDistance = Infinity;

            while (low <= high) {
              const mid = (low + high) >> 1;
              const el = pageEls[mid];
              const pageMidY = el.offsetTop + el.offsetHeight / 2;
              const dist = Math.abs(pageMidY - focalY);

              if (dist < minDistance) {
                minDistance = dist;
                bestIndex = mid;
              }

              if (pageMidY < focalY) {
                low = mid + 1;
              } else {
                high = mid - 1;
              }
            }

            for (const idx of [bestIndex - 1, bestIndex, bestIndex + 1]) {
              if (idx >= 0 && idx < len) {
                const el = pageEls[idx];
                const pageMidY = el.offsetTop + el.offsetHeight / 2;
                const dist = Math.abs(pageMidY - focalY);
                if (dist < minDistance) {
                  minDistance = dist;
                  bestIndex = idx;
                }
              }
            }

            const anchorEl = pageEls[bestIndex];
            anchorPageNum = parseInt(anchorEl.getAttribute('data-page') || '1', 10);
            const focalOffset = focalY - anchorEl.offsetTop;
            fractionY = anchorEl.offsetHeight > 0 ? focalOffset / anchorEl.offsetHeight : 0.5;
          }

          const scaleRatio = committedZoom / baseZoom;
          const targetScrollLeft =
            (gesture.focalPoint.x + gesture.initialScroll.left) * scaleRatio - gesture.focalPoint.x;

          setIsFitToWidth(false);
          setZoom(committedZoom);

          requestAnimationFrame(() => {
            const newRoot = scrollRootRef.current;
            if (!newRoot) return;
            const newAnchor = newRoot.querySelector<HTMLElement>(`[data-page="${anchorPageNum}"]`);
            if (newAnchor) {
              const targetTop = newAnchor.offsetTop + fractionY * newAnchor.offsetHeight - gesture.focalPoint.y;
              newRoot.scrollTop = Math.max(0, targetTop);
            }
            newRoot.scrollLeft = Math.max(0, targetScrollLeft);
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
  }, [pagesWrapperRef, scrollRootRef, setIsFitToWidth, setZoom]);

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
