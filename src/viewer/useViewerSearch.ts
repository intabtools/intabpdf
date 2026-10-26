// Custom hook managing in-document text search and match cycling in the PDF viewer.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { PdfDocument } from './renderPage';
import type { SearchMatch } from './types';
import { extractPagesBatch } from './textCache';

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

  // Text search asynchronously across loaded document pages with batched concurrent extraction,
  // progressive match streaming, and responsive event-loop yielding
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
        let initialMatchPublished = false;
        let lastPublishTime = performance.now();
        const BATCH_SIZE = 6;

        for (let batchStart = 1; batchStart <= pdfDoc.numPages; batchStart += BATCH_SIZE) {
          if (!active) return;

          const batchPages: number[] = [];
          for (
            let p = batchStart;
            p < batchStart + BATCH_SIZE && p <= pdfDoc.numPages;
            p++
          ) {
            batchPages.push(p);
          }

          const pageTexts = await extractPagesBatch(pdfDoc, batchPages);
          if (!active) return;

          let batchFoundMatches = false;

          for (const pageText of pageTexts) {
            // Fast rejection: skip pages that do not contain the query string
            if (!pageText.fullLowerText.includes(q)) continue;

            let matchOnPage = 0;
            for (const item of pageText.lowerItems) {
              let pos = 0;
              while ((pos = item.indexOf(q, pos)) !== -1) {
                foundMatches.push({
                  id: matchId++,
                  pageNumber: pageText.pageNumber,
                  matchIndexOnPage: matchOnPage++,
                });
                pos += q.length;
                batchFoundMatches = true;
              }
            }
          }

          // Progressive streaming: publish early matches as soon as found
          if (batchFoundMatches && active) {
            if (!initialMatchPublished && foundMatches.length > 0) {
              initialMatchPublished = true;
              setMatches([...foundMatches]);
              setCurrentMatchIndex(0);
              jumpToPage(foundMatches[0].pageNumber);
              lastPublishTime = performance.now();
            } else if (performance.now() - lastPublishTime > 150) {
              setMatches([...foundMatches]);
              lastPublishTime = performance.now();
            }
          }

          // Yield to event loop between batches so Android WebView remains fluid at 60 FPS
          if (batchStart + BATCH_SIZE <= pdfDoc.numPages) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (!active) return;
          }
        }

        if (!active) return;
        setMatches(foundMatches);
        setCurrentMatchIndex((prev) =>
          prev >= 0 ? prev : foundMatches.length > 0 ? 0 : -1
        );
        setIsSearching(false);

        if (!initialMatchPublished && foundMatches.length > 0) {
          jumpToPage(foundMatches[0].pageNumber);
        }
      } catch (err) {
        if (!active) return;
        console.warn('Text search encountered an error:', err);
        setMatches([]);
        setIsSearching(false);
      }
    }, 150);

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
