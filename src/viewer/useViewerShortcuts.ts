// Hook managing global keyboard shortcuts for the PDF viewer including search, fullscreen, and navigation.
import { useEffect } from 'react';
import type { RefObject } from 'react';

export interface UseViewerShortcutsOptions {
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  mobileThumbnailsOpen: boolean;
  setMobileThumbnailsOpen: (open: boolean) => void;
  isFullscreen: boolean;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  isDistractionFree: boolean;
  exitDistractionFree: () => void;
  jumpToPage: (page: number) => void;
  currentPage: number;
  numPages: number;
  zoomIn: () => void;
  zoomOut: () => void;
  toggleFitOrZoom: () => void;
}

export function useViewerShortcuts({
  isSearchOpen,
  setIsSearchOpen,
  searchInputRef,
  mobileThumbnailsOpen,
  setMobileThumbnailsOpen,
  isFullscreen,
  exitFullscreen,
  toggleFullscreen,
  isDistractionFree,
  exitDistractionFree,
  jumpToPage,
  currentPage,
  numPages,
  zoomIn,
  zoomOut,
  toggleFitOrZoom,
}: UseViewerShortcutsOptions): void {
  useEffect(() => {
    const handleViewerKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        if (isSearchOpen) {
          e.preventDefault();
          setIsSearchOpen(false);
          return;
        }
        if (mobileThumbnailsOpen) {
          e.preventDefault();
          setMobileThumbnailsOpen(false);
          return;
        }
        if (isFullscreen) {
          e.preventDefault();
          void exitFullscreen();
          return;
        }
        if (isDistractionFree) {
          e.preventDefault();
          exitDistractionFree();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }

      // Page navigation shortcuts
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        jumpToPage(currentPage - 1);
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        jumpToPage(currentPage + 1);
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        jumpToPage(1);
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        jumpToPage(numPages);
        return;
      }

      // Zoom shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        zoomOut();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        toggleFitOrZoom();
        return;
      }
    };
    window.addEventListener('keydown', handleViewerKeyDown);
    return () => window.removeEventListener('keydown', handleViewerKeyDown);
  }, [
    isSearchOpen,
    setIsSearchOpen,
    searchInputRef,
    mobileThumbnailsOpen,
    setMobileThumbnailsOpen,
    isFullscreen,
    exitFullscreen,
    isDistractionFree,
    exitDistractionFree,
    toggleFullscreen,
    jumpToPage,
    currentPage,
    numPages,
    zoomIn,
    zoomOut,
    toggleFitOrZoom,
  ]);
}
