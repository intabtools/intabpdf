// Hook managing scroll synchronization, viewport width measurement, and page jumping in the PDF viewer.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PageSize, PdfDocument } from './renderPage';

export interface UseViewerScrollSyncOptions {
  pdfDoc: PdfDocument | null;
  pageSizes?: PageSize[];
  currentPage: number;
  setCurrentPage: (page: number) => void;
  numPages: number;
  isFullscreen: boolean;
  showThumbnails: boolean;
  revealControlsTemporarily: (delayMs: number) => void;
  scrollRootRef: RefObject<HTMLElement | null>;
}

export interface UseViewerScrollSyncResult {
  cvsWidth: number;
  jumpToPage: (target: number) => void;
  handleScroll: () => void;
  isEditingPage: boolean;
  setIsEditingPage: (editing: boolean) => void;
  pageInputValue: string;
  setPageInputValue: (val: string) => void;
  pageInputRef: RefObject<HTMLInputElement | null>;
  handleStartPageEdit: () => void;
  handlePageJumpSubmit: () => void;
}

export function useViewerScrollSync({
  pdfDoc,
  pageSizes,
  currentPage,
  setCurrentPage,
  numPages,
  isFullscreen,
  showThumbnails,
  revealControlsTemporarily,
  scrollRootRef,
}: UseViewerScrollSyncOptions): UseViewerScrollSyncResult {
  const [cvsWidth, setCvsWidth] = useState(0);
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInputValue, setPageInputValue] = useState('');

  const pageInputRef = useRef<HTMLInputElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef<number | null>(null);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPageSizesRef = useRef<PageSize[] | undefined>(pageSizes);

  useEffect(() => {
    return () => {
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
    };
  }, []);

  // Anchor scroll position when pageSizes update (e.g. background measurement resolving actual dimensions)
  useEffect(() => {
    if (pageSizes && prevPageSizesRef.current !== pageSizes && pageSizes.length > 0) {
      prevPageSizesRef.current = pageSizes;
      const root = scrollRootRef.current;
      if (!root || !pdfDoc || currentPage <= 1) return;

      const anchorEl = root.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
      if (anchorEl) {
        const topBefore = anchorEl.getBoundingClientRect().top;
        requestAnimationFrame(() => {
          const currentRoot = scrollRootRef.current;
          if (!currentRoot) return;
          const currentAnchor = currentRoot.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
          if (currentAnchor) {
            const topAfter = currentAnchor.getBoundingClientRect().top;
            const shift = topAfter - topBefore;
            if (Math.abs(shift) > 0.5) {
              currentRoot.scrollTop += shift;
            }
          }
        });
      }
    } else {
      prevPageSizesRef.current = pageSizes;
    }
  }, [pageSizes, currentPage, pdfDoc, scrollRootRef]);

  useEffect(() => {
    if (isEditingPage) {
      pageInputRef.current?.focus();
      pageInputRef.current?.select();
    }
  }, [isEditingPage]);

  // Observe canvas viewport width for dynamic fit-to-width
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

    let rafId: number | null = null;
    const measure = () => {
      const currentRoot = scrollRootRef.current;
      if (!currentRoot) return;
      const style = window.getComputedStyle(currentRoot);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const usable = Math.max(0, currentRoot.clientWidth - paddingLeft - paddingRight);
      if (usable > 0) {
        setCvsWidth(usable);
      }
    };

    measure();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            setCvsWidth(w);
          });
        }
      }
    });

    observer.observe(root);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [scrollRootRef]);

  // Restore scroll position to currentPage on initial mount or document load
  const restoredDocRef = useRef<PdfDocument | null>(null);

  useEffect(() => {
    if (!pdfDoc) {
      restoredDocRef.current = null;
      return;
    }
    if (restoredDocRef.current === pdfDoc) return;
    if (currentPage > 1) {
      const root = scrollRootRef.current;
      const element = root?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
      if (element && root) {
        root.scrollTop = Math.max(0, element.offsetTop - 18);
        restoredDocRef.current = pdfDoc;
      } else {
        const raf = requestAnimationFrame(() => {
          const r = scrollRootRef.current;
          const el = r?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
          if (el && r) {
            r.scrollTop = Math.max(0, el.offsetTop - 18);
            restoredDocRef.current = pdfDoc;
          }
        });
        return () => cancelAnimationFrame(raf);
      }
    } else {
      restoredDocRef.current = pdfDoc;
    }
  }, [pdfDoc, currentPage, scrollRootRef]);

  // Keep active thumbnail visible in thumbnails strip
  useEffect(() => {
    if (!showThumbnails || !pdfDoc) return;
    const activeThumb = document.querySelector<HTMLElement>('.tn.on');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentPage, showThumbnails, pdfDoc]);

  const jumpToPage = useCallback(
    (target: number) => {
      const root = scrollRootRef.current;
      if (!root || !pdfDoc) return;
      const clamped = Math.max(1, Math.min(pdfDoc.numPages, target));
      const element = root.querySelector<HTMLElement>(`[data-page="${clamped}"]`);
      if (element) {
        if (programmaticScrollTimerRef.current) {
          clearTimeout(programmaticScrollTimerRef.current);
        }
        isProgrammaticScrollRef.current = clamped;
        programmaticScrollTimerRef.current = setTimeout(() => {
          isProgrammaticScrollRef.current = null;
        }, 400);

        const targetTop = Math.max(0, element.offsetTop - 18);
        root.scrollTop = targetTop;
        if (element.offsetWidth <= root.clientWidth + 2) {
          root.scrollLeft = 0;
        }
        setCurrentPage(clamped);
      }
    },
    [pdfDoc, scrollRootRef, setCurrentPage]
  );

  const handleScroll = useCallback(() => {
    if (isFullscreen) {
      revealControlsTemporarily(1800);
    }
    const root = scrollRootRef.current;
    if (!root || !pdfDoc) return;

    // Do not overwrite preserved page during initial scroll restoration
    if (restoredDocRef.current !== pdfDoc && currentPage > 1) return;

    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const currentRoot = scrollRootRef.current;
      if (!currentRoot) return;

      if (isProgrammaticScrollRef.current !== null) {
        const targetPage = isProgrammaticScrollRef.current;
        const targetEl = currentRoot.querySelector<HTMLElement>(`[data-page="${targetPage}"]`);
        if (targetEl) {
          const targetTop = Math.max(0, targetEl.offsetTop - 18);
          if (Math.abs(currentRoot.scrollTop - targetTop) <= 40) {
            isProgrammaticScrollRef.current = null;
          } else {
            return;
          }
        } else {
          isProgrammaticScrollRef.current = null;
        }
      }

      const pageEls = currentRoot.querySelectorAll<HTMLElement>('.pg-item[data-page]');
      const len = pageEls.length;
      if (len === 0) return;

      const targetMidY = currentRoot.scrollTop + currentRoot.clientHeight / 2;

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

      const closestPage = parseInt(pageEls[bestIndex].getAttribute('data-page') || '1', 10);
      setCurrentPage(closestPage);
    });
  }, [isFullscreen, revealControlsTemporarily, pdfDoc, scrollRootRef, setCurrentPage, currentPage]);

  const handleStartPageEdit = useCallback(() => {
    setPageInputValue(String(currentPage));
    setIsEditingPage(true);
  }, [currentPage]);

  const handlePageJumpSubmit = useCallback(() => {
    const val = parseInt(pageInputValue.trim(), 10);
    if (!isNaN(val) && val >= 1 && val <= numPages) {
      jumpToPage(val);
    }
    setIsEditingPage(false);
  }, [pageInputValue, numPages, jumpToPage]);

  return {
    cvsWidth,
    jumpToPage,
    handleScroll,
    isEditingPage,
    setIsEditingPage,
    pageInputValue,
    setPageInputValue,
    pageInputRef,
    handleStartPageEdit,
    handlePageJumpSubmit,
  };
}
