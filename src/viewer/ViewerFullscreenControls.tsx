// Floating pill controls for distraction-free and fullscreen reading modes.
import type { Dispatch, FocusEvent, ReactNode, RefObject, SetStateAction } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Minimize2,
  Minus,
  Plus,
  Search,
} from 'lucide-react';

interface ViewerFullscreenControlsProps {
  controlsVisible: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: (e: FocusEvent<HTMLDivElement>) => void;
  onExitFullscreen: () => void;
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  showThumbnails: boolean;
  mobileThumbnailsOpen: boolean;
  setShowThumbnails: Dispatch<SetStateAction<boolean>>;
  setMobileThumbnailsOpen: Dispatch<SetStateAction<boolean>>;
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
}

export default function ViewerFullscreenControls({
  controlsVisible,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onExitFullscreen,
  isSearchOpen,
  onToggleSearch,
  showThumbnails,
  mobileThumbnailsOpen,
  setShowThumbnails,
  setMobileThumbnailsOpen,
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
}: ViewerFullscreenControlsProps): ReactNode {
  return (
    <>
      {/* Top-Left: Exit Fullscreen */}
      <div
        className={`viewer-pill viewer-pill-tl ${controlsVisible ? 'visible' : 'hidden'}`}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <button
          type="button"
          className="viewer-pill-btn"
          onClick={onExitFullscreen}
          aria-label="Exit full screen (Esc or F)"
          title="Exit full screen (Esc or F)"
        >
          <Minimize2 size={16} strokeWidth={1.8} />
          <span className="viewer-pill-label">Exit</span>
        </button>
      </div>

      {/* Top-Right: Search and Thumbnails */}
      <div
        className={`viewer-pill viewer-pill-tr ${controlsVisible ? 'visible' : 'hidden'}`}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <button
          type="button"
          className={`viewer-pill-btn ${isSearchOpen ? 'active' : ''}`}
          onClick={onToggleSearch}
          aria-label="Find text in document (Ctrl+F)"
          title="Find text in document (Ctrl+F)"
        >
          <Search size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`viewer-pill-btn ${showThumbnails || mobileThumbnailsOpen ? 'active' : ''}`}
          onClick={() => {
            if (typeof window !== 'undefined' && window.innerWidth < 520) {
              setMobileThumbnailsOpen((prev) => !prev);
            } else {
              setShowThumbnails((prev) => !prev);
            }
          }}
          aria-label="Toggle thumbnails"
          title="Toggle thumbnails"
        >
          <LayoutGrid size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* Bottom-Center: Page Navigation */}
      <div
        className={`viewer-pill viewer-pill-bc ${controlsVisible ? 'visible' : 'hidden'}`}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        role="navigation"
        aria-label="Page navigation"
      >
        <button
          type="button"
          className="viewer-pill-btn"
          onClick={() => onJumpToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={16} strokeWidth={1.8} />
        </button>
        {isEditingPage ? (
          <form
            className="vtb-page-form"
            onSubmit={(e) => {
              e.preventDefault();
              onPageJumpSubmit();
            }}
          >
            <input
              ref={pageInputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pageInputValue}
              onChange={(e) => setPageInputValue(e.target.value.replace(/[^0-9]/g, ''))}
              className="vtb-page-input"
              aria-label={`Jump to page number (1 to ${numPages})`}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsEditingPage(false);
                }
              }}
              onBlur={onPageJumpSubmit}
            />
            <span className="vtb-page-total">/ {numPages}</span>
          </form>
        ) : (
          <button
            type="button"
            className="viewer-pill-badge"
            onClick={onStartPageEdit}
            aria-label={`Page ${currentPage} of ${numPages}. Click to enter page number`}
            title="Click to enter page number"
          >
            {`${currentPage} / ${numPages}`}
          </button>
        )}
        <button
          type="button"
          className="viewer-pill-btn"
          onClick={() => onJumpToPage(currentPage + 1)}
          disabled={currentPage >= numPages}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* Bottom-Right: Zoom Controls */}
      <div
        className={`viewer-pill viewer-pill-br ${controlsVisible ? 'visible' : 'hidden'}`}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        role="group"
        aria-label="Zoom controls"
      >
        <button
          type="button"
          className="viewer-pill-btn"
          onClick={onZoomOut}
          disabled={zoom <= 25 && !isFitToWidth}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`viewer-pill-badge ${isFitToWidth ? 'is-fit' : ''}`}
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
          {isFitToWidth ? `Fit (${Math.round(fitScale * 100)}%)` : `${zoom}%`}
        </button>
        <button
          type="button"
          className="viewer-pill-btn"
          onClick={onZoomIn}
          disabled={zoom >= 400 && !isFitToWidth}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus size={16} strokeWidth={1.8} />
        </button>
      </div>
    </>
  );
}
