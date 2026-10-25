// Search bar overlay for searching document text within the PDF viewer.
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { SearchMatch } from './types';

interface ViewerSearchBarProps {
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isSearching: boolean;
  setIsSearching: (searching: boolean) => void;
  matches: SearchMatch[];
  currentMatchIndex: number;
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  onClose: () => void;
}

export default function ViewerSearchBar({
  searchInputRef,
  searchQuery,
  setSearchQuery,
  isSearching,
  setIsSearching,
  matches,
  currentMatchIndex,
  onKeyDown,
  onPrevMatch,
  onNextMatch,
  onClose,
}: ViewerSearchBarProps): ReactNode {
  return (
    <div className="viewer-search-bar" role="search" aria-label="Find in document">
      <input
        ref={searchInputRef}
        type="text"
        placeholder="Find in document..."
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setIsSearching(Boolean(e.target.value.trim()));
        }}
        onKeyDown={onKeyDown}
        aria-label="Search document text"
      />
      {isSearching ? (
        <span className="search-count">Searching...</span>
      ) : searchQuery.trim() && matches.length === 0 ? (
        <span className="search-count no-match" role="status">
          No matches
        </span>
      ) : matches.length > 0 ? (
        <span className="search-count">
          {currentMatchIndex + 1} of {matches.length}
        </span>
      ) : null}
      <button
        type="button"
        className="ib sm"
        onClick={onPrevMatch}
        disabled={matches.length === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="ib sm"
        onClick={onNextMatch}
        disabled={matches.length === 0}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className="ib sm"
        onClick={onClose}
        aria-label="Close search"
        title="Close search (Esc)"
      >
        <X size={14} />
      </button>
    </div>
  );
}
