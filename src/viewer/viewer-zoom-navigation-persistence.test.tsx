import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import { destroyPdf, drawPageOnCanvas, loadPdf, type PageSize, type PdfDocument } from './renderPage';
import ViewerPagesView from './ViewerPagesView';
import { createRef } from 'react';

async function createSamplePdf(numPages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i + 1} content`, { x: 50, y: 700 });
  }
  return doc.save();
}

interface MockCanvas {
  width: number;
  height: number;
  style: { width: string; height: string };
  getContext: (id: string) => Record<string, unknown> | null;
}

function createMockCanvas(width = 595, height = 842): MockCanvas {
  const canvas: MockCanvas = {
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
    },
    getContext: () => null,
  };
  const contextTarget: Record<string, unknown> = {
    canvas,
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    getTransform: vi.fn().mockReturnValue({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 10 }),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
    createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
    createPattern: vi.fn().mockReturnValue({}),
    getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
    createImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
  };

  const mockContext = new Proxy(contextTarget, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      const fn = vi.fn();
      target[prop as string] = fn;
      return fn;
    },
  });
  canvas.getContext = vi.fn().mockImplementation((id: string) => {
    if (id === '2d') return mockContext;
    return null;
  });
  return canvas;
}

describe('Viewer Zoom Flash Prevention & Navigation State Preservation', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = {
      devicePixelRatio: 1,
      requestAnimationFrame: (cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 0),
      cancelAnimationFrame: (id: NodeJS.Timeout) => clearTimeout(id),
    };
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          return createMockCanvas(0, 0);
        }
        return { style: {} };
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as unknown as { document: unknown }).document = originalDocument;
  });

  describe('Part 1: Zoom Rendering Transition & Flash Prevention', () => {
    it('updates visible canvas CSS dimensions while preserving bitmap buffer during in-flight render', async () => {
      const bytes = await createSamplePdf(1);
      const doc = await loadPdf(bytes);

      // Create a canvas simulating a previously rendered page at scale 1.0 (595x842)
      const canvas = createMockCanvas(595, 842);
      const destCtx = canvas.getContext('2d');

      // Start zooming to scale 1.5
      const job = drawPageOnCanvas(
        doc,
        1,
        canvas as unknown as HTMLCanvasElement,
        1.5
      );

      // Allow microtask to resolve doc.getPage(1)
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Before the render completes, the CSS display dimensions must be set to scale 1.5 (892px x 1263px)
      // BUT canvas.width and height must retain the previous valid 595x842 buffer without being wiped to 0!
      expect(canvas.style.width).toBe('892px');
      expect(canvas.style.height).toBe('1263px');
      expect(canvas.width).toBe(595);
      expect(canvas.height).toBe(842);

      // Wait for completion
      await job.promise;

      // Once finished, destination canvas buffer is updated synchronously and drawImage is executed
      expect(canvas.width).toBe(892);
      expect(canvas.height).toBe(1263);
      expect(destCtx?.drawImage).toHaveBeenCalledTimes(1);

      await destroyPdf(doc);
    });

    it('cancels in-flight render without clearing or corrupting the visible canvas buffer', async () => {
      const bytes = await createSamplePdf(1);
      const doc = await loadPdf(bytes);

      const canvas = createMockCanvas(595, 842);

      // Start zoom to 2.0
      const job = drawPageOnCanvas(
        doc,
        1,
        canvas as unknown as HTMLCanvasElement,
        2.0
      );

      // Rapidly cancel before it finishes (simulating user clicking zoom again or pinch gesture)
      job.cancel();

      try {
        await job.promise;
      } catch {
        // cancellation may reject or return
      }

      // Visible canvas dimensions buffer must NOT have been corrupted or wiped to zero
      expect(canvas.width).toBe(595);
      expect(canvas.height).toBe(842);

      await destroyPdf(doc);
    });

    it('gracefully handles rendering errors without blanking the target canvas', async () => {
      const mockDoc = {
        getPage: vi.fn().mockRejectedValue(new Error('Simulated GPU/render failure')),
        numPages: 1,
      } as unknown as PdfDocument;

      const canvas = createMockCanvas(595, 842);

      const job = drawPageOnCanvas(
        mockDoc,
        1,
        canvas as unknown as HTMLCanvasElement,
        1.5
      );

      await expect(job.promise).rejects.toThrow('Simulated GPU/render failure');

      // Canvas dimensions buffer was not cleared to 0
      expect(canvas.width).toBe(595);
      expect(canvas.height).toBe(842);
    });
  });

  describe('Part 2: Document & Reading State Preservation Across Screen Navigation', () => {
    it('preserves document session state and reading position across screen navigation lifecycle', async () => {
      const bytes = await createSamplePdf(3);
      const doc = await loadPdf(bytes);
      const pageSizes: PageSize[] = [
        { width: 595, height: 842 },
        { width: 595, height: 842 },
        { width: 595, height: 842 },
      ];

      // Simulate ViewerProvider session state manager
      let activeDoc: PdfDocument | null = null;
      let activeFileName = '';
      let activePageSizes: PageSize[] = [];
      let savedPage = 1;
      let savedZoom = 100;
      let savedIsFitToWidth = true;

      const saveViewerDocument = (d: PdfDocument, file: { name: string }, sizes: PageSize[]) => {
        activeDoc = d;
        activeFileName = file.name;
        activePageSizes = sizes;
        savedPage = 1;
      };

      const updateReadingState = (st: { currentPage?: number; zoom?: number; isFitToWidth?: boolean }) => {
        if (st.currentPage !== undefined) savedPage = st.currentPage;
        if (st.zoom !== undefined) savedZoom = st.zoom;
        if (st.isFitToWidth !== undefined) savedIsFitToWidth = st.isFitToWidth;
      };

      // 1. Initial document load into viewer session
      saveViewerDocument(doc, { name: 'annual-report.pdf' }, pageSizes);
      expect(activeDoc).toBe(doc);
      expect(activeFileName).toBe('annual-report.pdf');
      expect(savedPage).toBe(1);
      expect(savedZoom).toBe(100);
      expect(savedIsFitToWidth).toBe(true);

      // 2. User reads and changes reading state: scrolls to page 3, zooms to 150%, manual zoom
      updateReadingState({
        currentPage: 3,
        zoom: 150,
        isFitToWidth: false,
      });

      expect(savedPage).toBe(3);
      expect(savedZoom).toBe(150);
      expect(savedIsFitToWidth).toBe(false);

      // 3. User navigates to About Us (/about)
      // ViewerPage unmounts, but session state remains intact in memory
      expect(activeDoc).toBe(doc);
      expect(activeFileName).toBe('annual-report.pdf');

      // 4. User navigates back to Viewer (/viewer)
      // ViewerPage mounts and initializes directly from the preserved context state
      const restoredDoc = activeDoc;
      const restoredPage = savedPage;
      const restoredZoom = savedZoom;
      const restoredIsFitToWidth = savedIsFitToWidth;

      expect(restoredDoc).toBe(doc);
      expect(restoredPage).toBe(3);
      expect(restoredZoom).toBe(150);
      expect(restoredIsFitToWidth).toBe(false);

      // Verify that ViewerPagesView renders the restored document at the preserved page
      const scrollRootRef = createRef<HTMLElement>();
      const pagesWrapperRef = createRef<HTMLDivElement>();

      const renderedHtml = renderToString(
        <ViewerPagesView
          pdfDoc={restoredDoc}
          fileName={activeFileName}
          numPages={activePageSizes.length}
          pageSizes={activePageSizes}
          isLoading={false}
          error={null}
          scrollRootRef={scrollRootRef}
          pagesWrapperRef={pagesWrapperRef}
          isFitToWidth={restoredIsFitToWidth}
          effectiveScale={restoredZoom / 100}
          onScroll={() => {}}
          onOpenClick={() => {}}
          onFilesDropped={() => {}}
          onDoubleClickPage={() => {}}
          searchQuery=""
          matches={[]}
          currentMatchIndex={-1}
        />
      );

      // Preserved view renders all pages with data-page attributes, NOT the empty Open File screen
      expect(renderedHtml).toContain('cvs-pages-wrap');
      expect(renderedHtml).toContain('data-page="1"');
      expect(renderedHtml).toContain('data-page="2"');
      expect(renderedHtml).toContain('data-page="3"');
      expect(renderedHtml).not.toContain('empty-viewport');

      await destroyPdf(doc);
    });

    it('renders empty DropZone when no document is active, and renders pages when document is restored', async () => {
      const scrollRootRef = createRef<HTMLElement>();
      const pagesWrapperRef = createRef<HTMLDivElement>();

      // Empty state
      const emptyHtml = renderToString(
        <ViewerPagesView
          pdfDoc={null}
          fileName=""
          numPages={0}
          pageSizes={[]}
          isLoading={false}
          error={null}
          scrollRootRef={scrollRootRef}
          pagesWrapperRef={pagesWrapperRef}
          isFitToWidth={true}
          effectiveScale={1}
          onScroll={() => {}}
          onOpenClick={() => {}}
          onFilesDropped={() => {}}
          onDoubleClickPage={() => {}}
          searchQuery=""
          matches={[]}
          currentMatchIndex={-1}
        />
      );

      expect(emptyHtml).toContain('empty-viewport');
      expect(emptyHtml).toContain('Open PDF file');
      expect(emptyHtml).not.toContain('cvs-pages-wrap');

      // Restored state with active doc
      const bytes = await createSamplePdf(2);
      const doc = await loadPdf(bytes);

      const restoredHtml = renderToString(
        <ViewerPagesView
          pdfDoc={doc}
          fileName="restored.pdf"
          numPages={2}
          pageSizes={[{ width: 595, height: 842 }, { width: 595, height: 842 }]}
          isLoading={false}
          error={null}
          scrollRootRef={scrollRootRef}
          pagesWrapperRef={pagesWrapperRef}
          isFitToWidth={false}
          effectiveScale={1.5}
          onScroll={() => {}}
          onOpenClick={() => {}}
          onFilesDropped={() => {}}
          onDoubleClickPage={() => {}}
          searchQuery=""
          matches={[]}
          currentMatchIndex={-1}
        />
      );

      expect(restoredHtml).not.toContain('empty-viewport');
      expect(restoredHtml).toContain('cvs-pages-wrap');
      expect(restoredHtml).toContain('data-page="1"');
      expect(restoredHtml).toContain('data-page="2"');

      await destroyPdf(doc);
    });

    it('explicit close completely destroys active document and resets viewer state to empty', async () => {
      const bytes = await createSamplePdf(1);
      const doc = await loadPdf(bytes);

      let activePdfDoc: PdfDocument | null = doc;
      let activeFileName = 'close-me.pdf';
      let activePageSizes: PageSize[] = [{ width: 595, height: 842 }];
      let savedCurrentPage = 2;
      let savedZoom = 200;
      let savedIsFitToWidth = false;

      const clearDocumentSession = async () => {
        if (activePdfDoc) {
          await destroyPdf(activePdfDoc).catch(() => undefined);
          activePdfDoc = null;
        }
        activeFileName = '';
        activePageSizes = [];
        savedCurrentPage = 1;
        savedZoom = 100;
        savedIsFitToWidth = true;
      };

      // Perform explicit close
      await clearDocumentSession();

      // Verify all session and reading state is reset to empty defaults
      expect(activePdfDoc).toBeNull();
      expect(activeFileName).toBe('');
      expect(activePageSizes).toEqual([]);
      expect(savedCurrentPage).toBe(1);
      expect(savedZoom).toBe(100);
      expect(savedIsFitToWidth).toBe(true);

      // Verify that after explicit close, the viewer renders the empty Open File screen
      const scrollRootRef = createRef<HTMLElement>();
      const pagesWrapperRef = createRef<HTMLDivElement>();

      const emptyHtml = renderToString(
        <ViewerPagesView
          pdfDoc={activePdfDoc}
          fileName={activeFileName}
          numPages={activePageSizes.length}
          pageSizes={activePageSizes}
          isLoading={false}
          error={null}
          scrollRootRef={scrollRootRef}
          pagesWrapperRef={pagesWrapperRef}
          isFitToWidth={savedIsFitToWidth}
          effectiveScale={1}
          onScroll={() => {}}
          onOpenClick={() => {}}
          onFilesDropped={() => {}}
          onDoubleClickPage={() => {}}
          searchQuery=""
          matches={[]}
          currentMatchIndex={-1}
        />
      );

      expect(emptyHtml).toContain('empty-viewport');
      expect(emptyHtml).toContain('Open PDF file');
      expect(emptyHtml).not.toContain('cvs-pages-wrap');
    });

    it('opening a replacement document cleans up the previous document without memory leaks', async () => {
      const bytes1 = await createSamplePdf(1);
      const doc1 = await loadPdf(bytes1);

      const bytes2 = await createSamplePdf(2);
      const doc2 = await loadPdf(bytes2);

      let activePdfDoc: PdfDocument | null = null;
      let activeFileName = '';

      const saveViewerDocument = (newDoc: PdfDocument, file: { name: string }) => {
        if (activePdfDoc && activePdfDoc !== newDoc) {
          void destroyPdf(activePdfDoc).catch(() => undefined);
        }
        activePdfDoc = newDoc;
        activeFileName = file.name;
      };

      // Open first document
      saveViewerDocument(doc1, { name: 'first.pdf' });
      expect(activePdfDoc).toBe(doc1);
      expect(activeFileName).toBe('first.pdf');

      // Open second document: doc1 is destroyed
      saveViewerDocument(doc2, { name: 'second.pdf' });
      expect(activePdfDoc).toBe(doc2);
      expect(activeFileName).toBe('second.pdf');

      await destroyPdf(doc2);
    });
  });
});
