// Page navigation controls with previous/next buttons and inline page jumping for the viewer toolbar.
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface ViewerPageNavigationProps {
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
}

export default function ViewerPageNavigation({
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
}: ViewerPageNavigationProps): ReactNode {
  return (
    <>
      <button
        type="button"
        className="ib sm"
        onClick={() => onJumpToPage(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="Previous page"
        title="Previous page"
      >
        <ChevronUp size={16} strokeWidth={1.8} />
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
            onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
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
          className="vtb-page-badge"
          onClick={onStartPageEdit}
          aria-label={`Page ${currentPage} of ${numPages}. Click to enter page number`}
          title="Click to enter page number"
        >
          {`${currentPage} / ${numPages}`}
        </button>
      )}
      <button
        type="button"
        className="ib sm"
        onClick={() => onJumpToPage(currentPage + 1)}
        disabled={currentPage >= numPages}
        aria-label="Next page"
        title="Next page"
      >
        <ChevronDown size={16} strokeWidth={1.8} />
      </button>
    </>
  );
}
