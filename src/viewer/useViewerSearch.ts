// Custom hook managing in-document text search and match cycling in the PDF viewer.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { PdfDocument } from './renderPage';
import type { SearchMatch } from './types';

interface UseViewerSearchOptions {
  pdfDoc: PdfDocument | null;
  jumpToPage: (page: number) => void;
}

interface UseViewerSearchResult {
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  matches: SearchMatch[];
  currentMatchIndex: number;
  isSearching: boolean;
  setIsSearching: (searching: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  goToNextMatch: () => void;
  goToPrevMatch: () => void;
  handleToggleSearch: () => void;
  handleSearchInputKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}

export function useViewerSearch({
  pdfDoc,
  jumpToPage,
}: UseViewerSearchOptions): UseViewerSearchResult {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Text search asynchronously across loaded document pages
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    let active = true;

    const timer = setTimeout(async () => {
      if (!q || !pdfDoc) {
        if (active) {
          setMatches([]);
          setCurrentMatchIndex(-1);
          setIsSearching(false);
        }
        return;
      }

      setIsSearching(true);
      try {
        const foundMatches: SearchMatch[] = [];
        let matchId = 0;
        for (let p = 1; p <= pdfDoc.numPages; p++) {
          if (!active) return;
          const page = await pdfDoc.getPage(p);
          const content = await page.getTextContent();
          let matchOnPage = 0;
          for (const item of content.items) {
            if (!('str' in item)) continue;
            const str = (item as { str: string }).str;
            if (!str) continue;
            const lower = str.toLowerCase();
            let pos = 0;
            while ((pos = lower.indexOf(q, pos)) !== -1) {
              foundMatches.push({ id: matchId++, pageNumber: p, matchIndexOnPage: matchOnPage++ });
              pos += q.length;
            }
          }
        }

        if (!active) return;
        setMatches(foundMatches);
        setCurrentMatchIndex(foundMatches.length > 0 ? 0 : -1);
        setIsSearching(false);

        if (foundMatches.length > 0) {
          jumpToPage(foundMatches[0].pageNumber);
        }
      } catch (err) {
        if (!active) return;
        console.warn('Text search encountered an error:', err);
        setMatches([]);
        setIsSearching(false);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, pdfDoc, jumpToPage]);

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIdx);
    jumpToPage(matches[nextIdx].pageNumber);
  };

  const goToPrevMatch = () => {
    if (matches.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIdx);
    jumpToPage(matches[prevIdx].pageNumber);
  };

  const handleToggleSearch = () => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      return next;
    });
  };

  const handleSearchInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsSearchOpen(false);
    }
  };

  return {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    matches,
    currentMatchIndex,
    isSearching,
    setIsSearching,
    searchInputRef,
    goToNextMatch,
    goToPrevMatch,
    handleToggleSearch,
    handleSearchInputKeyDown,
  };
}
