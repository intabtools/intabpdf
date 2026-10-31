// Custom hook managing in-document text search and match cycling in the PDF viewer.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { PdfDocument } from './renderPage';
import type { SearchMatch } from './types';
import { extractPagesBatch } from './textCache';

export interface UseViewerSearchOptions {
  pdfDoc: PdfDocument | null;
  jumpToPage: (page: number) => void;
  currentPage?: number;
}

export interface UseViewerSearchResult {
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

/**
 * Builds an array of page numbers starting from startPage up to numPages,
 * wrapping around from 1 to startPage - 1.
 */
export function buildPageSequence(numPages: number, startPage: number): number[] {
  if (numPages <= 0) return [];
  const pages: number[] = [];
  const clampedStart = Math.max(1, Math.min(numPages, startPage));
  for (let p = clampedStart; p <= numPages; p++) {
    pages.push(p);
  }
  for (let p = 1; p < clampedStart; p++) {
    pages.push(p);
  }
  return pages;
}

export function useViewerSearch({
  pdfDoc,
  jumpToPage,
  currentPage,
}: UseViewerSearchOptions): UseViewerSearchResult {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentPageRef = useRef(currentPage ?? 1);
  useEffect(() => {
    currentPageRef.current = currentPage ?? 1;
  }, [currentPage]);

  const userNavigatedRef = useRef(false);

  // Text search asynchronously across loaded document pages with batched extraction starting from current reading page,
  // progressive match streaming, and responsive event-loop yielding
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    let active = true;
    userNavigatedRef.current = false;

    const timer = setTimeout(async () => {
      if (!q || !pdfDoc) {
        if (active) {
          setMatches([]);
          setCurrentMatchIndex(-1);
          setIsSearching(false);
        }
        return;
      }

      const readingPage = currentPageRef.current || 1;
      setIsSearching(true);
      try {
        const foundMatches: SearchMatch[] = [];
        let initialMatchPublished = false;
        let lastPublishTime = performance.now();
        const BATCH_SIZE = 6;

        const pageSequence = buildPageSequence(pdfDoc.numPages, readingPage);

        for (let batchIdx = 0; batchIdx < pageSequence.length; batchIdx += BATCH_SIZE) {
          if (!active) return;

          const batchPages = pageSequence.slice(batchIdx, batchIdx + BATCH_SIZE);
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
                  id: 0, // Assigned after sorting
                  pageNumber: pageText.pageNumber,
                  matchIndexOnPage: matchOnPage++,
                });
                pos += q.length;
                batchFoundMatches = true;
              }
            }
          }

          // Sort matches in natural document order (page 1..N) to preserve total document count and sequential navigation
          if (batchFoundMatches && active) {
            foundMatches.sort((a, b) => {
              if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
              return a.matchIndexOnPage - b.matchIndexOnPage;
            });
            foundMatches.forEach((m, idx) => {
              m.id = idx;
            });

            const targetIdx = foundMatches.findIndex((m) => m.pageNumber >= readingPage);
            const activeIdx = targetIdx !== -1 ? targetIdx : 0;

            if (!initialMatchPublished && foundMatches.length > 0) {
              initialMatchPublished = true;
              setMatches([...foundMatches]);
              setCurrentMatchIndex(activeIdx);
              jumpToPage(foundMatches[activeIdx].pageNumber);
              lastPublishTime = performance.now();
            } else if (performance.now() - lastPublishTime > 150) {
              setMatches([...foundMatches]);
              setCurrentMatchIndex((prev) => {
                if (userNavigatedRef.current && prev >= 0 && prev < foundMatches.length) {
                  return prev;
                }
                return activeIdx;
              });
              lastPublishTime = performance.now();
            }
          }

          // Yield to event loop between batches so Android WebView remains fluid at 60 FPS
          if (batchIdx + BATCH_SIZE < pageSequence.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (!active) return;
          }
        }

        if (!active) return;

        foundMatches.sort((a, b) => {
          if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
          return a.matchIndexOnPage - b.matchIndexOnPage;
        });
        foundMatches.forEach((m, idx) => {
          m.id = idx;
        });

        const finalTargetIdx = foundMatches.findIndex((m) => m.pageNumber >= readingPage);
        const finalActiveIdx = finalTargetIdx !== -1 ? finalTargetIdx : 0;

        setMatches(foundMatches);
        setCurrentMatchIndex((prev) => {
          if (userNavigatedRef.current && prev >= 0 && prev < foundMatches.length) {
            return prev;
          }
          return foundMatches.length > 0 ? finalActiveIdx : -1;
        });
        setIsSearching(false);

        if (!initialMatchPublished && foundMatches.length > 0) {
          jumpToPage(foundMatches[finalActiveIdx].pageNumber);
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
    userNavigatedRef.current = true;
    const nextIdx = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIdx);
    jumpToPage(matches[nextIdx].pageNumber);
  };

  const goToPrevMatch = () => {
    if (matches.length === 0) return;
    userNavigatedRef.current = true;
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
