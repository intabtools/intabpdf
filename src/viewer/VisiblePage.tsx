// Component for rendering a single visible PDF page with canvas, text layer, search highlights, and annotation links.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { drawPageOnCanvas, renderPageAnnotationLayer, renderPageTextLayer } from './renderPage';
import type { VisiblePageProps } from './types';

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
}: VisiblePageProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(
    () => pageNumber === 1 || typeof IntersectionObserver === 'undefined'
  );
  const [textLayerReady, setTextLayerReady] = useState(0);

  const width = Math.max(1, Math.round(baseSize.width * scale));
  const height = Math.max(1, Math.round(baseSize.height * scale));

  // Render canvas and textlayer only for pages near the visible scroll area
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    const root = scrollRootRef?.current || null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === element) {
            setIsVisible(entry.isIntersecting);
          }
        }
      },
      { root, rootMargin: '400px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRootRef]);

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
    if (!isVisible || !textLayer) return;

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
  }, [doc, pageNumber, scale, isVisible]);

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
      spans.forEach((span) => {
        if (span.dataset.rawText !== undefined) {
          span.textContent = span.dataset.rawText;
          delete span.dataset.rawText;
        }
      });
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

    appliedQueryRef.current = q;
    appliedLayerReadyRef.current = textLayerReady;
  }, [searchQuery, matches, currentMatchIndex, pageNumber, textLayerReady]);

  return (
    <div
      ref={containerRef}
      data-page={pageNumber}
      className="pg-item"
      style={{ width: `${width}px`, height: `${height}px` }}
      onDoubleClick={onDoubleClick}
    >
      {isVisible ? (
        <>
          <canvas ref={canvasRef} />
          <div ref={textLayerRef} className="textLayer" />
          <div ref={annotationLayerRef} className="annotationLayer" />
        </>
      ) : (
        <span className="pg-placeholder">Page {pageNumber}</span>
      )}
    </div>
  );
}
