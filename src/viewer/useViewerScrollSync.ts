// Hook managing scroll synchronization, viewport width measurement, and page jumping in the PDF viewer.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PdfDocument } from './renderPage';

export interface UseViewerScrollSyncOptions {
  pdfDoc: PdfDocument | null;
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
        const targetTop = Math.max(0, element.offsetTop - 18);
        root.scrollTop = targetTop;
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

    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const currentRoot = scrollRootRef.current;
      if (!currentRoot) return;

      const cvsRect = currentRoot.getBoundingClientRect();
      const midY = cvsRect.top + cvsRect.height / 2;
      const pageEls = currentRoot.querySelectorAll<HTMLElement>('.pg-item[data-page]');

      let closestPage = 1;
      let minDistance = Infinity;

      for (let i = 0; i < pageEls.length; i++) {
        const el = pageEls[i];
        const rect = el.getBoundingClientRect();
        const pageMidY = rect.top + rect.height / 2;
        const dist = Math.abs(pageMidY - midY);
        if (dist < minDistance) {
          minDistance = dist;
          const pageNum = parseInt(el.getAttribute('data-page') || '1', 10);
          closestPage = pageNum;
        }
      }
      setCurrentPage(closestPage);
    });
  }, [isFullscreen, revealControlsTemporarily, pdfDoc, scrollRootRef, setCurrentPage]);

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
