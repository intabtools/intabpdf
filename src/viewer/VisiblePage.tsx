// Component for rendering a single visible PDF page with canvas, text layer, search highlights, and annotation links.
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import {
  beginSelectionRestorationGuard,
  drawPageOnCanvas,
  renderPageAnnotationLayer,
  renderPageTextLayer,
  restoreDocumentSelectionSnapshot,
  snapshotActiveTextSelectionForLayer,
} from './renderPage';
import type { VisiblePageProps } from './types';

function selectionIntersectsNode(node: HTMLElement | null): boolean {
  if (!node || typeof window === 'undefined') return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (range.intersectsNode(node)) {
      return true;
    }
  }
  return false;
}

export default function VisiblePage({
  doc,
  pageNumber,
  scale,
  baseSize,
  scrollRootRef,
  onDoubleClick,
  searchQuery = '',
  matches = [],
  currentMatchIndex = -1,
  linkService,
  allowCopying = true,
}: VisiblePageProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(
    () => pageNumber === 1 || typeof IntersectionObserver === 'undefined'
  );
  const [preserveSelectionLayer, setPreserveSelectionLayer] = useState(false);
  const [textLayerReady, setTextLayerReady] = useState(0);

  const width = Math.max(1, Math.round(baseSize.width * scale));
  const height = Math.max(1, Math.round(baseSize.height * scale));
  const isTextLayerMounted = isVisible || preserveSelectionLayer;

  // Render canvas/annotations near viewport, while keeping textLayer alive across scroll if selected
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    const root = scrollRootRef?.current || null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === element) {
            const nextVisible = entry.isIntersecting;
            if (!nextVisible && selectionIntersectsNode(textLayerRef.current)) {
              setPreserveSelectionLayer(true);
            } else if (nextVisible) {
              setPreserveSelectionLayer(false);
            }
            setIsVisible(nextVisible);
          }
        }
      },
      { root, rootMargin: '400px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRootRef]);

  // Release off-screen preserved text layer once selection collapses
  useEffect(() => {
    if (!preserveSelectionLayer || typeof document === 'undefined') return;
    const handleSelectionChange = () => {
      if (!selectionIntersectsNode(textLayerRef.current)) {
        setPreserveSelectionLayer(false);
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [preserveSelectionLayer]);

  const appliedQueryRef = useRef<string>('');
  const appliedLayerReadyRef = useRef<number>(-1);

  // Canvas drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isVisible || !canvas) return;

    let active = true;
    const job = drawPageOnCanvas(doc, pageNumber, canvas, scale);
    job.promise.catch((error: unknown) => {
      if (!active) return;
      if (
        error instanceof Error &&
        (error.name === 'RenderingCancelledException' || error.name === 'AbortException')
      ) {
        return;
      }
      console.error(`Failed to render PDF page ${pageNumber}:`, error);
    });

    return () => {
      active = false;
      job.cancel();
    };
  }, [doc, pageNumber, scale, isVisible]);

  // Text layer rendering
  useEffect(() => {
    const textLayer = textLayerRef.current;
    if (!isTextLayerMounted || !textLayer) return;

    let active = true;
    const job = renderPageTextLayer(doc, pageNumber, textLayer, scale);
    job.promise
      .then(() => {
        if (!active) return;
        setTextLayerReady((v) => v + 1);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (
          error instanceof Error &&
          (error.name === 'RenderingCancelledException' || error.name === 'AbortException')
        ) {
          return;
        }
      });

    return () => {
      active = false;
      job.cancel();
    };
  }, [doc, pageNumber, scale, isTextLayerMounted]);

  // Manage .selecting state and .endOfContent expansion while selecting across links/margins
  useEffect(() => {
    const textLayer = textLayerRef.current;
    if (!isTextLayerMounted || !textLayer || typeof document === 'undefined') return;

    const resetSelecting = () => {
      textLayer.classList.remove('selecting');
    };

    const handlePointerDown = () => {
      if (allowCopying) {
        textLayer.classList.add('selecting');
      }
    };

    const handlePointerUp = () => {
      if (!selectionIntersectsNode(textLayer)) {
        resetSelecting();
      }
    };

    const handleSelectionChange = () => {
      if (allowCopying && selectionIntersectsNode(textLayer)) {
        textLayer.classList.add('selecting');
      } else {
        resetSelecting();
      }
    };

    textLayer.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('blur', resetSelecting);

    return () => {
      textLayer.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('blur', resetSelecting);
      resetSelecting();
    };
  }, [isTextLayerMounted, allowCopying]);

  // Annotation layer rendering (PDF links & destinations)
  useEffect(() => {
    const annotationLayer = annotationLayerRef.current;
    if (!isVisible || !annotationLayer || !linkService) return;

    let active = true;
    const job = renderPageAnnotationLayer(doc, pageNumber, annotationLayer, scale, linkService);
    job.promise.catch((error: unknown) => {
      if (!active) return;
      if (
        error instanceof Error &&
        (error.name === 'RenderingCancelledException' || error.name === 'AbortException')
      ) {
        return;
      }
      console.error(`Failed to render annotations for PDF page ${pageNumber}:`, error);
    });

    return () => {
      active = false;
      job.cancel();
    };
  }, [doc, pageNumber, scale, isVisible, linkService]);

  // Visible search highlights application with fast active-match toggling
  useEffect(() => {
    const container = textLayerRef.current;
    if (!container) return;

    const q = searchQuery.trim().toLowerCase();
    const spans = Array.from(
      container.querySelectorAll<HTMLSpanElement>('span:not(.markedContent)')
    );

    if (!q) {
      const hasRawSpans = spans.some((span) => span.dataset.rawText !== undefined);
      if (hasRawSpans) {
        const savedSelection = snapshotActiveTextSelectionForLayer(container);
        const releaseGuard = savedSelection ? beginSelectionRestorationGuard() : null;
        try {
          spans.forEach((span) => {
            if (span.dataset.rawText !== undefined) {
              span.textContent = span.dataset.rawText;
              delete span.dataset.rawText;
            }
          });
          if (savedSelection) {
            restoreDocumentSelectionSnapshot(savedSelection);
          }
        } finally {
          releaseGuard?.();
        }
      }
      appliedQueryRef.current = '';
      appliedLayerReadyRef.current = textLayerReady;
      return;
    }

    if (spans.length === 0) {
      return;
    }

    // Fast-path: if the highlights for this query and text layer are already rendered,
    // only update the active-match class without destroying or re-creating DOM nodes
    if (
      appliedQueryRef.current === q &&
      appliedLayerReadyRef.current === textLayerReady
    ) {
      const currentActive = container.querySelector<HTMLElement>('.search-highlight.active-match');
      if (currentActive && currentActive.dataset.matchId !== String(currentMatchIndex)) {
        currentActive.classList.remove('active-match');
      }

      if (currentMatchIndex >= 0) {
        const nextActive = container.querySelector<HTMLElement>(
          `.search-highlight[data-match-id="${currentMatchIndex}"]`
        );
        if (nextActive && !nextActive.classList.contains('active-match')) {
          nextActive.classList.add('active-match');
          try {
            nextActive.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    const pageMatches = matches.filter((m) => m.pageNumber === pageNumber);
    let pageMatchCounter = 0;
    const savedSelection = snapshotActiveTextSelectionForLayer(container);
    const releaseGuard = savedSelection ? beginSelectionRestorationGuard() : null;

    try {
      for (const span of spans) {
        if (span.dataset.rawText === undefined) {
          span.dataset.rawText = span.textContent ?? '';
        }
        const rawText = span.dataset.rawText;
        const lower = rawText.toLowerCase();

        if (!lower.includes(q)) {
          span.textContent = rawText;
          continue;
        }

        span.innerHTML = '';
        let lastIndex = 0;
        let pos = lower.indexOf(q, 0);

        while (pos !== -1) {
          if (pos > lastIndex) {
            span.appendChild(document.createTextNode(rawText.slice(lastIndex, pos)));
          }

          const matchedText = rawText.slice(pos, pos + q.length);
          const mark = document.createElement('mark');
          mark.className = 'search-highlight';
          mark.textContent = matchedText;

          const currentMatch = pageMatches[pageMatchCounter];
          if (currentMatch) {
            mark.dataset.matchId = String(currentMatch.id);
            if (currentMatch.id === currentMatchIndex) {
              mark.classList.add('active-match');
              try {
                mark.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              } catch {
                // ignore
              }
            }
          }
          pageMatchCounter++;

          span.appendChild(mark);
          lastIndex = pos + q.length;
          pos = lower.indexOf(q, lastIndex);
        }

        if (lastIndex < rawText.length) {
          span.appendChild(document.createTextNode(rawText.slice(lastIndex)));
        }
      }

      if (savedSelection) {
        restoreDocumentSelectionSnapshot(savedSelection);
      }
    } finally {
      releaseGuard?.();
    }

    appliedQueryRef.current = q;
    appliedLayerReadyRef.current = textLayerReady;
  }, [searchQuery, matches, currentMatchIndex, pageNumber, textLayerReady]);

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (allowCopying && target?.closest('.textLayer span, .annotationLayer a')) {
      return;
    }
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (allowCopying && sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      return;
    }
    onDoubleClick?.();
  };

  return (
    <div
      ref={containerRef}
      data-page={pageNumber}
      className="pg-item"
      style={{ width: `${width}px`, height: `${height}px` }}
      onDoubleClick={handleDoubleClick}
    >
      {isVisible && (
        <canvas
          ref={canvasRef}
          style={{ width: `${width}px`, height: `${height}px` }}
        />
      )}
      {isTextLayerMounted && (
        <div
          ref={textLayerRef}
          className={allowCopying ? 'textLayer' : 'textLayer copy-restricted'}
        />
      )}
      {isVisible && <div ref={annotationLayerRef} className="annotationLayer" />}
      {!isVisible && !isTextLayerMounted && (
        <span className="pg-placeholder">Page {pageNumber}</span>
      )}
    </div>
  );
}
