// Top toolbar for standard reading mode in the PDF viewer.
import type { ReactNode, RefObject } from 'react';
import {
  Eye,
  EyeOff,
  FolderOpen,
  LayoutGrid,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type { PdfDocument } from './renderPage';
import ViewerPageNavigation from './ViewerPageNavigation';

interface ViewerToolbarProps {
  pdfDoc: PdfDocument | null;
  isLoading: boolean;
  onOpenClick: () => void;
  onOpenPalette: () => void;
  onCloseDocument: () => void;
  showThumbnails: boolean;
  mobileThumbnailsOpen?: boolean;
  onToggleThumbnails: () => void;
  currentPage: number;
  numPages: number;
  onJumpToPage: (page: number) => void;
  isEditingPage: boolean;
  setIsEditingPage: (editing: boolean) => void;
  pageInputRef: RefObject<HTMLInputElement | null>;
  pageInputValue: string;
  setPageInputValue: (value: string) => void;
  onPageJumpSubmit: () => void;
  onStartPageEdit: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  isFitToWidth: boolean;
  fitScale: number;
  onToggleFitOrZoom: () => void;
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  autoHideControls: boolean;
  onToggleAutoHide: () => void;
  isDistractionFree: boolean;
  onToggleDistractionFree: () => void;
}

export default function ViewerToolbar({
  pdfDoc,
  isLoading,
  onOpenClick,
  onOpenPalette,
  onCloseDocument,
  showThumbnails,
  mobileThumbnailsOpen = false,
  onToggleThumbnails,
  currentPage,
  numPages,
  onJumpToPage,
  isEditingPage,
  setIsEditingPage,
  pageInputRef,
  pageInputValue,
  setPageInputValue,
  onPageJumpSubmit,
  onStartPageEdit,
  zoom,
  onZoomIn,
  onZoomOut,
  isFitToWidth,
  fitScale,
  onToggleFitOrZoom,
  isSearchOpen,
  onToggleSearch,
  isFullscreen,
  onToggleFullscreen,
  autoHideControls,
  onToggleAutoHide,
  isDistractionFree,
  onToggleDistractionFree,
}: ViewerToolbarProps): ReactNode {
  return (
    <div className={`vtb${!pdfDoc ? ' vtb-empty' : ''}`}>
      {!pdfDoc ? (
        <>
          {isLoading ? (
            <span className="vtb-status-msg">Opening PDF…</span>
          ) : (
            <button
              type="button"
              className="vtb-open-btn"
              onClick={onOpenClick}
              aria-label="Open PDF"
            >
              <FolderOpen size={15} />
              <span>Open PDF</span>
            </button>
          )}
          <i className="sp" />
          <button
            type="button"
            className="ib sm"
            onClick={onOpenPalette}
            aria-label="Search tools catalog (Ctrl+K)"
            title="Search tools catalog (Ctrl+K)"
          >
            <Search size={16} />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="ib sm vtb-desktop-toggle"
            onClick={onOpenClick}
            aria-label="Open another PDF"
            title="Open another PDF"
          >
            <FolderOpen size={16} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            className="ib sm vtb-close-btn"
            onClick={onCloseDocument}
            aria-label="Close PDF"
            title="Close PDF"
          >
            <X size={18} strokeWidth={2} />
          </button>

          <i className="sep vtb-desktop-toggle" />

          <button
            type="button"
            className={`ib sm ${showThumbnails || mobileThumbnailsOpen ? 'active' : ''}`}
            onClick={onToggleThumbnails}
            aria-label={
              showThumbnails || mobileThumbnailsOpen
                ? 'Hide page thumbnails'
                : 'Show page thumbnails'
            }
            title={
              showThumbnails || mobileThumbnailsOpen
                ? 'Hide page thumbnails'
                : 'Show page thumbnails'
            }
          >
            <LayoutGrid size={16} strokeWidth={1.8} />
          </button>

          <i className="sep vtb-desktop-toggle" />

          <ViewerPageNavigation
            currentPage={currentPage}
            numPages={numPages}
            onJumpToPage={onJumpToPage}
            isEditingPage={isEditingPage}
            setIsEditingPage={setIsEditingPage}
            pageInputRef={pageInputRef}
            pageInputValue={pageInputValue}
            setPageInputValue={setPageInputValue}
            onPageJumpSubmit={onPageJumpSubmit}
            onStartPageEdit={onStartPageEdit}
          />

          <i className="sep vtb-desktop-toggle" />

          <button
            type="button"
            className="ib sm vtb-desktop-toggle"
            onClick={onZoomOut}
            disabled={zoom <= 25 && !isFitToWidth}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={`zoom-badge ${isFitToWidth ? 'is-fit' : ''}`}
            onClick={onToggleFitOrZoom}
            aria-label={
              isFitToWidth
                ? `Fit to width (${Math.round(fitScale * 100)}%) active. Click to zoom 100%`
                : `Current zoom ${zoom}%. Click to fit to width`
            }
            title={
              isFitToWidth
                ? `Fit to width (${Math.round(fitScale * 100)}%) - click for 100%`
                : `Zoom level: ${zoom}% - click to fit to width`
            }
          >
            <span className="zoom-label-full">
              {isFitToWidth ? `Fit (${Math.round(fitScale * 100)}%)` : `${zoom}%`}
            </span>
            <span className="zoom-label-compact">
              {isFitToWidth ? 'Fit' : `${zoom}%`}
            </span>
          </button>
          <button
            type="button"
            className="ib sm vtb-desktop-toggle"
            onClick={onZoomIn}
            disabled={zoom >= 400 && !isFitToWidth}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus size={16} strokeWidth={1.8} />
          </button>

          <i className="sp" />

          <button
            type="button"
            className={`ib sm ${isSearchOpen ? 'active' : ''}`}
            onClick={onToggleSearch}
            aria-label="Find text in document (Ctrl+F)"
            title="Find in document (Ctrl+F)"
          >
            <Search size={16} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            className="ib sm"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? 'Exit full screen (F)' : 'Enter full screen (F)'}
            title={isFullscreen ? 'Exit full screen (F)' : 'Enter full screen (F)'}
          >
            {isFullscreen ? (
              <Minimize2 size={16} strokeWidth={1.8} />
            ) : (
              <Maximize2 size={16} strokeWidth={1.8} />
            )}
          </button>

          <button
            type="button"
            className={`ib sm vtb-desktop-toggle ${autoHideControls ? 'active' : ''}`}
            onClick={onToggleAutoHide}
            aria-label={
              autoHideControls
                ? 'Auto-hide fullscreen controls: ON'
                : 'Auto-hide fullscreen controls: OFF'
            }
            title={
              autoHideControls
                ? 'Auto-hide controls in fullscreen: ON (Click to keep controls visible)'
                : 'Auto-hide controls in fullscreen: OFF (Click to auto-hide controls)'
            }
          >
            {autoHideControls ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
          </button>

          <button
            type="button"
            className={`ib sm ${isDistractionFree ? 'active' : ''}`}
            onClick={onToggleDistractionFree}
            aria-label={
              isDistractionFree ? 'Exit distraction-free mode (Esc)' : 'Enter distraction-free mode'
            }
            title={
              isDistractionFree
                ? 'Exit distraction-free mode (Esc)'
                : 'Distraction-free reading (Lock UI)'
            }
          >
            {isDistractionFree ? (
              <LockOpen size={16} strokeWidth={1.8} />
            ) : (
              <Lock size={16} strokeWidth={1.8} />
            )}
          </button>
        </>
      )}
    </div>
  );
}
