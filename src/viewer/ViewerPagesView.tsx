// Main canvas pages viewport for the PDF viewer, with empty, loading, error, and page render states.
import type { ReactNode, RefObject } from 'react';
import { AlertTriangle } from 'lucide-react';
import DropZone from '../components/DropZone';
import type { OpenedFile } from '../platform';
import VisiblePage from './VisiblePage';
import type { PageSize, PdfDocument } from './renderPage';
import type { SearchMatch } from './types';

const DEFAULT_PAGE_SIZE: PageSize = { width: 595, height: 842 };

interface ViewerPagesViewProps {
  pdfDoc: PdfDocument | null;
  fileName: string;
  numPages: number;
  pageSizes: PageSize[];
  isLoading: boolean;
  error: string | null;
  scrollRootRef: RefObject<HTMLElement | null>;
  pagesWrapperRef: RefObject<HTMLDivElement | null>;
  isFitToWidth: boolean;
  effectiveScale: number;
  onScroll: () => void;
  onOpenClick: () => void;
  onFilesDroppedStart?: () => void;
  onFilesDropped: (files: OpenedFile[]) => void;
  onReturnHome?: () => void;
  onDoubleClickPage: () => void;
  searchQuery: string;
  matches: SearchMatch[];
  currentMatchIndex: number;
}

export default function ViewerPagesView({
  pdfDoc,
  fileName,
  numPages,
  pageSizes,
  isLoading,
  error,
  scrollRootRef,
  pagesWrapperRef,
  isFitToWidth,
  effectiveScale,
  onScroll,
  onOpenClick,
  onFilesDroppedStart,
  onFilesDropped,
  onReturnHome,
  onDoubleClickPage,
  searchQuery,
  matches,
  currentMatchIndex,
}: ViewerPagesViewProps): ReactNode {
  return (
    <main
      ref={scrollRootRef}
      className={`cvs ${isFitToWidth ? 'fit-mode' : 'manual-zoom-mode'}`}
      onScroll={onScroll}
    >
      {isLoading && !pdfDoc && (
        <div className="pdf-loading-view" role="status" aria-live="polite">
          <div className="pdf-loading-spinner" aria-hidden="true">
            <svg viewBox="0 0 48 48" className="pdf-spinner-svg">
              <circle
                className="pdf-spinner-track"
                cx="24"
                cy="24"
                r="18"
                fill="none"
                strokeWidth="4"
              />
              <circle
                className="pdf-spinner-arc"
                cx="24"
                cy="24"
                r="18"
                fill="none"
                strokeWidth="4"
              />
            </svg>
          </div>
          <span className="pdf-loading-text">Opening PDF…</span>
        </div>
      )}

      {error && (
        <div className="viewer-state-box error" role="alert">
          <AlertTriangle size={36} className="state-err-icon" />
          <h3>Could not open PDF</h3>
          <p>{error}</p>
          <div className="viewer-error-actions">
            <button type="button" className="cta" onClick={onOpenClick}>
              Choose another file
            </button>
            {onReturnHome && (
              <button type="button" className="vtb-btn" onClick={onReturnHome}>
                Return to home
              </button>
            )}
          </div>
        </div>
      )}

      {!pdfDoc && !isLoading && !error && (
        <div className="empty-viewport">
          <div className="empty-card">
            <DropZone
              title="Open PDF file"
              subtitle="Choose a PDF from your device or drop it here to read."
              ctaText="Choose file"
              onFilesSelectedStart={onFilesDroppedStart}
              onFilesSelected={onFilesDropped}
            />
          </div>
        </div>
      )}

      {pdfDoc && !error && (
        <div ref={pagesWrapperRef} className="cvs-pages-wrap">
          {Array.from({ length: numPages }, (_, index) => {
            const pageNumber = index + 1;
            const baseSize = pageSizes[index] ?? DEFAULT_PAGE_SIZE;
            return (
              <VisiblePage
                key={`page-${fileName}-${pageNumber}`}
                doc={pdfDoc}
                pageNumber={pageNumber}
                scale={effectiveScale}
                baseSize={baseSize}
                scrollRootRef={scrollRootRef}
                onDoubleClick={onDoubleClickPage}
                searchQuery={searchQuery}
                matches={matches}
                currentMatchIndex={currentMatchIndex}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}
