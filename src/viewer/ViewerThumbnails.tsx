// Sidebar thumbnail rail and mobile sheet thumbnails for document navigation.
import type { Dispatch, FocusEvent, ReactNode, SetStateAction } from 'react';
import { X } from 'lucide-react';
import PageThumbnail from './PageThumbnail';
import type { PageSize, PdfDocument } from './renderPage';

const DEFAULT_PAGE_SIZE: PageSize = { width: 595, height: 842 };

interface ViewerThumbnailsProps {
  pdfDoc: PdfDocument;
  fileName: string;
  numPages: number;
  pageSizes: PageSize[];
  currentPage: number;
  showThumbnails: boolean;
  mobileThumbnailsOpen: boolean;
  setMobileThumbnailsOpen: Dispatch<SetStateAction<boolean>>;
  jumpToPage: (page: number) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: (e: FocusEvent<HTMLDivElement>) => void;
  onThumbnailScroll: () => void;
}

export default function ViewerThumbnails({
  pdfDoc,
  fileName,
  numPages,
  pageSizes,
  currentPage,
  showThumbnails,
  mobileThumbnailsOpen,
  setMobileThumbnailsOpen,
  jumpToPage,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onThumbnailScroll,
}: ViewerThumbnailsProps): ReactNode {
  return (
    <>
      {showThumbnails && (
        <aside
          className={`thm ${showThumbnails ? 'visible' : ''}`}
          aria-label="Page thumbnails"
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onFocus={onFocus}
          onBlur={onBlur}
          onScroll={onThumbnailScroll}
        >
          {Array.from({ length: numPages }, (_, index) => {
            const pageNumber = index + 1;
            const baseSize = pageSizes[index] ?? DEFAULT_PAGE_SIZE;
            return (
              <PageThumbnail
                key={`thumb-${fileName}-${pageNumber}`}
                doc={pdfDoc}
                pageNumber={pageNumber}
                baseSize={baseSize}
                isActive={currentPage === pageNumber}
                onClick={() => jumpToPage(pageNumber)}
              />
            );
          })}
        </aside>
      )}

      {mobileThumbnailsOpen && (
        <div
          className="mobile-thm-backdrop"
          onClick={() => setMobileThumbnailsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Document thumbnails"
        >
          <div
            className="mobile-thm-sheet"
            onClick={(e) => e.stopPropagation()}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onFocus={onFocus}
            onBlur={onBlur}
          >
            <div className="mobile-thm-header">
              <h3>Thumbnails ({numPages})</h3>
              <button
                type="button"
                className="ib sm"
                onClick={() => setMobileThumbnailsOpen(false)}
                aria-label="Close thumbnails"
                title="Close thumbnails"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mobile-thm-list" onScroll={onThumbnailScroll}>
              {Array.from({ length: numPages }, (_, index) => {
                const pageNumber = index + 1;
                const baseSize = pageSizes[index] ?? DEFAULT_PAGE_SIZE;
                return (
                  <PageThumbnail
                    key={`mobile-thumb-${fileName}-${pageNumber}`}
                    doc={pdfDoc}
                    pageNumber={pageNumber}
                    baseSize={baseSize}
                    isActive={currentPage === pageNumber}
                    onClick={() => {
                      jumpToPage(pageNumber);
                      setMobileThumbnailsOpen(false);
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
