// Shared type definitions for the PDF viewer components, hooks, and search.
import type { Dispatch, FocusEvent, RefObject, SetStateAction } from 'react';
import type { PageSize, PdfDocument } from './renderPage';
import type { PdfLinkService } from './pdfLinks';

export interface SearchMatch {
  id: number;
  pageNumber: number;
  matchIndexOnPage: number;
}

export interface VisiblePageProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  baseSize: PageSize;
  scrollRootRef: React.RefObject<HTMLElement | null>;
  onDoubleClick?: () => void;
  searchQuery?: string;
  matches?: SearchMatch[];
  currentMatchIndex?: number;
  linkService?: PdfLinkService;
}

export interface PageThumbnailProps {
  doc: PdfDocument;
  pageNumber: number;
  baseSize: PageSize;
  isActive: boolean;
  onClick: () => void;
}

export interface UseViewerFullscreenOptions {
  shellRef: RefObject<HTMLDivElement | null>;
  showAppLayout: boolean;
  setShowAppLayout: (show: boolean) => void;
  showThumbnails: boolean;
  setShowThumbnails: Dispatch<SetStateAction<boolean>>;
  setMobileThumbnailsOpen: Dispatch<SetStateAction<boolean>>;
}

export interface UseViewerFullscreenResult {
  isDistractionFree: boolean;
  setIsDistractionFree: Dispatch<SetStateAction<boolean>>;
  isFullscreen: boolean;
  setIsFullscreen: Dispatch<SetStateAction<boolean>>;
  autoHideControls: boolean;
  setAutoHideControls: Dispatch<SetStateAction<boolean>>;
  controlsVisible: boolean;
  setControlsVisible: Dispatch<SetStateAction<boolean>>;
  clearAutoHideTimer: () => void;
  scheduleAutoHide: (delayMs: number) => void;
  revealControlsTemporarily: (delayMs?: number) => void;
  toggleAutoHide: () => void;
  handleControlsPointerEnter: () => void;
  handleControlsPointerLeave: () => void;
  handleControlsFocus: () => void;
  handleControlsBlur: (e: FocusEvent<HTMLDivElement>) => void;
  enterDistractionFree: () => void;
  exitDistractionFree: () => void;
  toggleDistractionFree: () => void;
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  normalThumbnailsRef: RefObject<boolean>;
}
