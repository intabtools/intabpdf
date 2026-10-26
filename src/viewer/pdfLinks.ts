// PDF link resolution, URL validation, and internal destination navigation service.
import { openExternalUrl } from '../platform';
import type { PdfDocument } from './renderPage';

export interface PdfLinkService {
  doc: PdfDocument;
  onNavigate: (pageNumber: number) => void;
  setCurrentPage: (pageNumber: number) => void;
  addLinkAttributes: (link: HTMLAnchorElement, url: string, newWindow?: boolean) => void;
  getDestinationHash: (destination: unknown) => string;
  goToDestination: (destination: unknown) => Promise<void>;
  getAnchorUrl: (hash?: string) => string;
  executeNamedAction: (action: string) => void;
  eventBus?: { dispatch: (eventName: string, data: unknown) => void };
}

/**
 * Validates that an external URL begins with http:// or https://.
 * Blocks all local file schemes, javascript:, intent:, data:, and malformed strings.
 */
export function isValidExternalUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Creates an implementation of the PDF.js link service interface.
 * Handles both external Web navigation and internal PDF page jumps.
 */
export function createPdfLinkService(
  doc: PdfDocument,
  onNavigate: (pageNumber: number) => void,
  initialPage = 1,
): PdfLinkService {
  let activePage = initialPage;

  return {
    doc,
    onNavigate,
    setCurrentPage(pageNumber: number) {
      if (typeof pageNumber === 'number' && !isNaN(pageNumber)) {
        activePage = pageNumber;
      }
    },

    addLinkAttributes(link: HTMLAnchorElement, url: string, _newWindow?: boolean): void {
      void _newWindow;
      if (!url || typeof url !== 'string') {
        link.removeAttribute('href');
        link.style.pointerEvents = 'none';
        return;
      }

      const trimmed = url.trim();
      if (isValidExternalUrl(trimmed)) {
        link.href = trimmed;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = trimmed;
        link.onclick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          openExternalUrl(trimmed);
          return false;
        };
      } else {
        // Disarm malformed or unsafe URLs without executing them
        link.removeAttribute('href');
        link.style.pointerEvents = 'none';
        link.title = 'Blocked unsafe or invalid link';
        link.onclick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          return false;
        };
      }
    },

    getDestinationHash(destination: unknown): string {
      if (typeof destination === 'string') {
        return `#${destination}`;
      }
      return '#';
    },

    getAnchorUrl(hash?: string): string {
      return `#${hash || ''}`;
    },

    async goToDestination(destination: unknown): Promise<void> {
      if (!destination) return;

      try {
        let explicitDest: unknown = destination;

        // Resolve named destination string to explicit destination array
        if (typeof destination === 'string') {
          explicitDest = await doc.getDestination(destination);
        }

        if (!explicitDest) return;

        let pageRef: unknown;
        if (Array.isArray(explicitDest)) {
          pageRef = explicitDest[0];
        } else {
          pageRef = explicitDest;
        }

        let targetPage: number | null = null;

        // PDF reference object: { num, gen }
        if (pageRef && typeof pageRef === 'object' && 'num' in pageRef) {
          const pageIndex = await doc.getPageIndex(pageRef as { num: number; gen: number });
          if (typeof pageIndex === 'number' && !isNaN(pageIndex) && pageIndex >= 0) {
            targetPage = pageIndex + 1;
          }
        } else if (typeof pageRef === 'number') {
          // 0-based page index or 1-based page number
          if (pageRef >= 0 && pageRef < doc.numPages) {
            targetPage = pageRef + 1;
          } else if (pageRef >= 1 && pageRef <= doc.numPages) {
            targetPage = pageRef;
          }
        }

        if (targetPage !== null && targetPage >= 1 && targetPage <= doc.numPages) {
          onNavigate(targetPage);
        }
      } catch (err) {
        console.warn('Failed to resolve internal PDF destination:', err);
      }
    },

    executeNamedAction(action: string): void {
      if (!action || typeof action !== 'string') return;

      switch (action) {
        case 'NextPage':
          onNavigate(Math.min(doc.numPages, activePage + 1));
          break;
        case 'PrevPage':
          onNavigate(Math.max(1, activePage - 1));
          break;
        case 'FirstPage':
          onNavigate(1);
          break;
        case 'LastPage':
          onNavigate(doc.numPages);
          break;
        default:
          break;
      }
    },

    eventBus: {
      dispatch: () => {},
    },
  };
}
