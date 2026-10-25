import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  LayoutGrid,
  Lock,
  Maximize2,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import DropZone from '../components/DropZone';
import { useShell } from '../hooks/useShell';
import type { OpenedFile } from '../platform';
import { useViewer } from '../hooks/useViewer';
import {
  destroyPdf,
  drawPageOnCanvas,
  getPageSize,
  loadPdf,
  type PageSize,
  type PdfDocument,
} from './renderPage';
import './viewer.css';

const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200];
const DEFAULT_PAGE_SIZE: PageSize = { width: 595, height: 842 };

interface VisiblePageProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  baseSize: PageSize;
  scrollRoot: HTMLElement | null;
  onInView: (pageNumber: number) => void;
}

function VisiblePage({
  doc,
  pageNumber,
  scale,
  baseSize,
  scrollRoot,
  onInView,
}: VisiblePageProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const width = Math.max(1, Math.round(baseSize.width * scale));
  const height = Math.max(1, Math.round(baseSize.height * scale));

  // Render canvas only for pages near the visible scroll area
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { root: scrollRoot, rootMargin: '400px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // Update current page indicator when page crosses viewport center
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onInView(pageNumber);
      },
      { root: scrollRoot, rootMargin: '-45% 0px -45% 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot, pageNumber, onInView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isVisible || !canvas) return;

    const job = drawPageOnCanvas(doc, pageNumber, canvas, scale);
    job.promise.catch((error: unknown) => {
      if (
        error instanceof Error &&
        (error.name === 'RenderingCancelledException' || error.name === 'AbortException')
      ) {
        return;
      }
      console.error(`Failed to render PDF page ${pageNumber}:`, error);
    });

    return () => job.cancel();
  }, [doc, pageNumber, scale, isVisible]);

  return (
    <div
      ref={containerRef}
      data-page={pageNumber}
      className="pg-item"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {isVisible ? (
        <canvas ref={canvasRef} />
      ) : (
        <span className="pg-placeholder">Page {pageNumber}</span>
      )}
    </div>
  );
}

interface PageThumbnailProps {
  doc: PdfDocument;
  pageNumber: number;
  baseSize: PageSize;
  isActive: boolean;
  onClick: () => void;
}

function PageThumbnail({
  doc,
  pageNumber,
  baseSize,
  isActive,
  onClick,
}: PageThumbnailProps): ReactNode {
  const containerRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const thumbWidth = 84;
  const aspectRatio = baseSize.height / baseSize.width;
  const thumbHeight = Math.round(thumbWidth * aspectRatio);
  const thumbScale = thumbWidth / baseSize.width;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '200px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isVisible || !canvas) return;

    const job = drawPageOnCanvas(doc, pageNumber, canvas, thumbScale);
    job.promise.catch(() => {
      // Ignored for thumbnails
    });

    return () => job.cancel();
  }, [doc, pageNumber, thumbScale, isVisible]);

  return (
    <button
      ref={containerRef}
      type="button"
      className={`tn ${isActive ? 'on' : ''}`}
      onClick={onClick}
      aria-label={`Jump to page ${pageNumber}`}
    >
      <div
        className="pg-thumb"
        style={{ width: `${thumbWidth}px`, height: `${thumbHeight}px` }}
      >
        {isVisible ? (
          <canvas ref={canvasRef} />
        ) : (
          <span className="pg-placeholder">{pageNumber}</span>
        )}
      </div>
      <span>{pageNumber}</span>
    </button>
  );
}

export default function ViewerPage(): ReactNode {
  const { currentFile, loadFile, openPdfPicker } = useViewer();
  const { shell, setShowAppLayout } = useShell();

  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [isFitToWidth, setIsFitToWidth] = useState(true);
  const [cvsWidth, setCvsWidth] = useState(0);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [mobileThumbnailsOpen, setMobileThumbnailsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiHidden, setUiHidden] = useState(false);
  const [padlockVisible, setPadlockVisible] = useState(false);

  const padlockTimerRef = useRef<number | null>(null);
  const loadRequestRef = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);

  const clearPadlockTimer = useCallback(() => {
    if (padlockTimerRef.current !== null) {
      window.clearTimeout(padlockTimerRef.current);
      padlockTimerRef.current = null;
    }
  }, []);

  const showPadlockBriefly = useCallback(() => {
    clearPadlockTimer();
    setPadlockVisible(true);
    padlockTimerRef.current = window.setTimeout(() => {
      setPadlockVisible(false);
      padlockTimerRef.current = null;
    }, 2200);
  }, [clearPadlockTimer]);

  const openDocument = useCallback(async (file: OpenedFile) => {
    const requestId = ++loadRequestRef.current;
    let doc: PdfDocument | null = null;
    let adopted = false;
    setPdfDoc(null);
    setPageSizes([]);
    setFileName(file.name);
    setCurrentPage(1);
    setIsLoading(true);
    setError(null);

    try {
      doc = await loadPdf(file.bytes);
      const firstSize =
        doc.numPages > 0 ? await getPageSize(doc, 1) : DEFAULT_PAGE_SIZE;

      if (requestId !== loadRequestRef.current) {
        void destroyPdf(doc).catch(() => undefined);
        return;
      }

      setPdfDoc(doc);
      adopted = true;
      setPageSizes(Array.from({ length: doc.numPages }, () => firstSize));
      setIsLoading(false);

      const activeDoc = doc;
      void Promise.all(
        Array.from({ length: activeDoc.numPages }, async (_, index) => {
          try {
            return await getPageSize(activeDoc, index + 1);
          } catch {
            return firstSize;
          }
        }),
      ).then((sizes) => {
        if (requestId === loadRequestRef.current) setPageSizes(sizes);
      });
    } catch (loadError) {
      if (doc && !adopted) {
        void destroyPdf(doc).catch(() => undefined);
      }
      if (requestId === loadRequestRef.current) {
        console.error('Failed to open PDF:', loadError);
        setPdfDoc(null);
        setPageSizes([]);
        setError(
          'Could not open this PDF. Check whether the file is damaged, unsupported, or password-protected.',
        );
        setIsLoading(false);
      }
    }
  }, []);

  // When context currentFile changes, load it asynchronously
  const lastOpenedFileRef = useRef<OpenedFile | null>(null);

  useEffect(() => {
    if (currentFile && currentFile !== lastOpenedFileRef.current) {
      lastOpenedFileRef.current = currentFile;
      const timer = setTimeout(() => {
        void openDocument(currentFile);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [currentFile, openDocument]);

  useEffect(() => {
    return () => {
      loadRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void destroyPdf(pdfDoc).catch(() => undefined);
      }
    };
  }, [pdfDoc]);

  useEffect(() => {
    return () => clearPadlockTimer();
  }, [clearPadlockTimer]);

  const handleOpenClick = async () => {
    const file = await openPdfPicker();
    if (file) {
      loadFile(file);
    }
  };

  const handleFilesDropped = (files: OpenedFile[]) => {
    if (files.length > 0) {
      loadFile(files[0]);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files?.[0];
    if (!dropped) return;

    if (
      dropped.type !== 'application/pdf' &&
      !dropped.name.toLowerCase().endsWith('.pdf')
    ) {
      setPdfDoc(null);
      setPageSizes([]);
      setError('Please choose a PDF file.');
      return;
    }

    try {
      const buffer = await dropped.arrayBuffer();
      const opened: OpenedFile = {
        name: dropped.name,
        bytes: new Uint8Array(buffer),
      };
      loadFile(opened);
    } catch (err) {
      console.error('Failed to read dropped file:', err);
      setPdfDoc(null);
      setPageSizes([]);
      setError('Could not read that file. Please try selecting it again.');
    }
  };

  // Observe canvas viewport width for dynamic fit-to-width
  useEffect(() => {
    if (!scrollRoot) return;

    let rafId: number | null = null;
    const measure = () => {
      const w = scrollRoot.clientWidth;
      if (w > 0) {
        setCvsWidth(w);
      }
    };

    measure();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            setCvsWidth(w);
          });
        }
      }
    });

    observer.observe(scrollRoot);
    window.addEventListener('resize', measure);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [scrollRoot]);

  // Keep active thumbnail visible in thumbnails strip
  useEffect(() => {
    if (!showThumbnails || !pdfDoc) return;
    const activeThumb = document.querySelector<HTMLElement>('.tn.on');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentPage, showThumbnails, pdfDoc]);

  const jumpToPage = (target: number) => {
    if (!scrollRoot || !pdfDoc) return;
    const clamped = Math.max(1, Math.min(pdfDoc.numPages, target));
    const element = scrollRoot.querySelector<HTMLElement>(`[data-page="${clamped}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrentPage(clamped);
    }
  };

  const numPages = pdfDoc?.numPages ?? 0;
  const firstPageWidth = pageSizes[0]?.width || DEFAULT_PAGE_SIZE.width;
  const availableWidth = Math.max(120, cvsWidth - 36);
  const fitScale = cvsWidth > 0 ? Math.min(3.0, Math.max(0.15, availableWidth / firstPageWidth)) : 1;
  const effectiveScale = isFitToWidth ? fitScale : zoom / 100;

  const zoomOut = () => {
    const currentPercent = Math.round(effectiveScale * 100);
    const prev = [...ZOOM_STEPS].reverse().find((step) => step < currentPercent);
    setIsFitToWidth(false);
    setZoom(prev ?? Math.max(25, currentPercent - 25));
  };

  const zoomIn = () => {
    const currentPercent = Math.round(effectiveScale * 100);
    const next = ZOOM_STEPS.find((step) => step > currentPercent);
    setIsFitToWidth(false);
    setZoom(next ?? Math.min(200, currentPercent + 25));
  };

  const toggleFitOrZoom = () => {
    if (isFitToWidth) {
      setIsFitToWidth(false);
      setZoom(100);
    } else {
      setIsFitToWidth(true);
    }
  };

  const handleOpenPalette = () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
  };

  const pingPadlock = useCallback(() => {
    if (uiHidden) showPadlockBriefly();
  }, [showPadlockBriefly, uiHidden]);

  const enterFullScreen = useCallback(async () => {
    setUiHidden(true);
    setShowAppLayout(false);
    showPadlockBriefly();
    try {
      if (shellRef.current && !document.fullscreenElement) {
        await shellRef.current.requestFullscreen();
      }
    } catch {
      // Ignored
    }
  }, [showPadlockBriefly, setShowAppLayout]);

  const exitFullScreen = useCallback(async () => {
    setUiHidden(false);
    setShowAppLayout(true);
    setPadlockVisible(false);
    clearPadlockTimer();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Ignored
    }
  }, [clearPadlockTimer, setShowAppLayout]);

  useEffect(() => {
    return () => {
      setShowAppLayout(true);
    };
  }, [setShowAppLayout]);

  useEffect(() => {
    const handleViewerKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape' && mobileThumbnailsOpen) {
        setMobileThumbnailsOpen(false);
        return;
      }
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (uiHidden) {
          void exitFullScreen();
        } else {
          void enterFullScreen();
        }
      }
    };
    window.addEventListener('keydown', handleViewerKeyDown);
    return () => window.removeEventListener('keydown', handleViewerKeyDown);
  }, [uiHidden, enterFullScreen, exitFullScreen, mobileThumbnailsOpen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setUiHidden(false);
        setPadlockVisible(false);
        clearPadlockTimer();
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [clearPadlockTimer]);

  const viewerContent = (
    <div
      ref={shellRef}
      className="viewer-shell"
      onMouseMove={uiHidden ? pingPadlock : undefined}
      onTouchStart={uiHidden ? pingPadlock : undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void handleDrop(e)}
    >
      {!uiHidden && (
        <div className="vtb">
          {!pdfDoc ? (
            <>
              {isLoading ? (
                <span className="vtb-status-msg">Opening document...</span>
              ) : (
                <button
                  type="button"
                  className="vtb-open-btn"
                  onClick={() => void handleOpenClick()}
                  aria-label="Open PDF"
                >
                  <FolderOpen size={15} />
                  <span>Open PDF</span>
                </button>
              )}
              <i className="sp" />
              <button
                type="button"
                className="ib sm"
                onClick={handleOpenPalette}
                aria-label="Search tools catalog (Ctrl+K)"
                title="Search tools catalog (Ctrl+K)"
              >
                <Search size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`ib sm ${showThumbnails ? 'active' : ''}`}
                onClick={() => setShowThumbnails((prev) => !prev)}
                aria-label="Thumbnails"
                title="Thumbnails"
              >
                <LayoutGrid size={16} strokeWidth={1.8} />
              </button>

              <i className="sep" />

              <button
                type="button"
                className="ib sm"
                onClick={() => jumpToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="Previous page"
                title="Previous page"
              >
                <ChevronUp size={16} strokeWidth={1.8} />
              </button>
              <em>{`${currentPage} / ${numPages}`}</em>
              <button
                type="button"
                className="ib sm"
                onClick={() => jumpToPage(currentPage + 1)}
                disabled={currentPage >= numPages}
                aria-label="Next page"
                title="Next page"
              >
                <ChevronDown size={16} strokeWidth={1.8} />
              </button>

              <i className="sep" />

              <button
                type="button"
                className="ib sm"
                onClick={zoomOut}
                disabled={zoom <= 50 && !isFitToWidth}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus size={16} strokeWidth={1.8} />
              </button>
              <em
                onClick={toggleFitOrZoom}
                style={{ cursor: 'pointer' }}
                title={
                  isFitToWidth
                    ? 'Fit to width (click for 100%)'
                    : 'Zoom level (click to fit to width)'
                }
              >
                {isFitToWidth ? 'Fit' : `${zoom}%`}
              </em>
              <button
                type="button"
                className="ib sm"
                onClick={zoomIn}
                disabled={zoom >= 200 && !isFitToWidth}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus size={16} strokeWidth={1.8} />
              </button>

              <i className="sp" />

              <button
                type="button"
                className="ib sm"
                onClick={() => void enterFullScreen()}
                aria-label="Toggle full screen (F)"
                title="Toggle full screen (F)"
              >
                <Maximize2 size={16} strokeWidth={1.8} />
              </button>

              <button
                type="button"
                className="ib sm"
                onClick={handleOpenPalette}
                aria-label="Search tools catalog (Ctrl+K)"
                title="Search tools catalog (Ctrl+K)"
              >
                <Search size={16} strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>
      )}

      {uiHidden && (
        <div className={`padlock-top ${padlockVisible ? '' : 'hidden'}`}>
          <button
            type="button"
            className="padlock-btn"
            onClick={() => void exitFullScreen()}
            aria-label="Exit full screen and show UI"
          >
            <Lock size={15} />
            <span>Unlock UI</span>
          </button>
        </div>
      )}

      <div className="vwr">
        {pdfDoc && !error && showThumbnails && (
          <aside
            className={`thm ${showThumbnails ? 'visible' : ''}`}
            aria-label="Page thumbnails"
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

        <main
          ref={setScrollRoot}
          className={`cvs ${isFitToWidth ? 'fit-mode' : 'manual-zoom-mode'}`}
          onScroll={uiHidden ? pingPadlock : undefined}
        >
          {isLoading && !pdfDoc && (
            <div className="viewer-state-box loading" role="status" aria-live="polite">
              <div className="vtb-spinner" />
              <h3>Opening document...</h3>
              <p>Reading PDF pages.</p>
            </div>
          )}

          {error && (
            <div className="viewer-state-box error" role="alert">
              <AlertTriangle size={36} className="state-err-icon" />
              <h3>Could not open PDF</h3>
              <p>{error}</p>
              <button
                type="button"
                className="cta"
                onClick={() => void handleOpenClick()}
              >
                Choose another file
              </button>
            </div>
          )}

          {!pdfDoc && !isLoading && !error && (
            <div className="empty-viewport">
              <div className="empty-card">
                <DropZone
                  title="Open PDF file"
                  subtitle="Choose a PDF from your device or drop it here to read."
                  ctaText="Choose file"
                  onFilesSelected={handleFilesDropped}
                />
              </div>
            </div>
          )}

          {pdfDoc && !error &&
            Array.from({ length: numPages }, (_, index) => {
              const pageNumber = index + 1;
              const baseSize = pageSizes[index] ?? DEFAULT_PAGE_SIZE;
              return (
                <VisiblePage
                  key={`page-${fileName}-${pageNumber}`}
                  doc={pdfDoc}
                  pageNumber={pageNumber}
                  scale={effectiveScale}
                  baseSize={baseSize}
                  scrollRoot={scrollRoot}
                  onInView={setCurrentPage}
                />
              );
            })}
        </main>

        {pdfDoc && !error && (
          <div className="pl" aria-label="Page navigation">
            <button
              type="button"
              onClick={() => jumpToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronUp size={16} />
            </button>
            <span
              onClick={() => setMobileThumbnailsOpen(true)}
              style={{ cursor: 'pointer' }}
              title="View thumbnails"
            >
              {currentPage} / {numPages}
            </span>
            <button
              type="button"
              onClick={() => jumpToPage(currentPage + 1)}
              disabled={currentPage >= numPages}
              aria-label="Next page"
              title="Next page"
            >
              <ChevronDown size={16} />
            </button>
            <button
              type="button"
              onClick={() => setMobileThumbnailsOpen(true)}
              aria-label="Show thumbnails"
              title="Show thumbnails"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
        )}

        {pdfDoc && !error && mobileThumbnailsOpen && (
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
            >
              <div className="mobile-thm-header">
                <h3>Thumbnails ({numPages})</h3>
                <button
                  type="button"
                  className="ib sm"
                  onClick={() => setMobileThumbnailsOpen(false)}
                  aria-label="Close thumbnails"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mobile-thm-list">
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
      </div>
    </div>
  );

  if (shell === 'web') {
    return (
      <div className="wp">
        <nav className="bc" aria-label="Breadcrumb">
          <Link to="/">All tools</Link>
          <span aria-hidden="true">/</span>
          <b>{fileName || 'PDF Viewer'}</b>
        </nav>
        <div className="vframe">{viewerContent}</div>
      </div>
    );
  }

  return viewerContent;
}
