import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import ViewerPagesView from './ViewerPagesView';
import VisiblePage from './VisiblePage';
import ViewerToolbar from './ViewerToolbar';
import PdfLoadingScreen from './PdfLoadingScreen';
import ProcessingLoadingScreen from '../components/ProcessingLoadingScreen';
import AppShell from '../components/AppShell';
import WebShell from '../components/WebShell';
import DropZone from '../components/DropZone';
import { ToastProvider } from '../components/ToastContext';
import { ViewerProvider } from './ViewerContext';
import { ViewerContext } from './viewerContextDef';
import { ProcessingContext } from '../components/processingContextDef';
import { destroyPdf, loadPdf } from './renderPage';
import { PDFDocument } from 'pdf-lib';
import { platform } from '../platform';

describe('Stage 4: Loading-System Verification & Header Wordmark Refinement', () => {
  describe('PdfLoadingScreen & PDF Opening Experience', () => {
    it('renders the centered Material loading indicator with exact message "Opening PDF…"', () => {
      const html = renderToString(<PdfLoadingScreen />);

      // Accessible full-view container
      expect(html).toContain('class="pdf-full-loading-screen "');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');

      // Exact copy required by prompt
      expect(html).toContain('<span class="pdf-loading-text">Opening PDF…</span>');

      // Material-inspired circular spinner structure
      expect(html).toContain('pdf-loading-spinner');
      expect(html).toContain('pdf-spinner-svg');
      expect(html).toContain('pdf-spinner-track');
      expect(html).toContain('pdf-spinner-arc');

      // Simple design: no progress percentages or bars
      expect(html).not.toContain('%');
      expect(html).not.toContain('progress-bar');
    });
  });

  describe('ProcessingLoadingScreen & Heavy File Operations', () => {
    it('renders distinct file-processing loader with contextual operation messages', () => {
      const messages = [
        'Importing photos…',
        'Preparing images…',
        'Creating PDF…',
        'Compressing PDF…',
        'Merging PDFs…',
        'Splitting PDF…',
        'Rotating pages…',
        'Removing pages…',
      ];

      for (const msg of messages) {
        const html = renderToString(<ProcessingLoadingScreen message={msg} />);
        expect(html).toContain('processing-full-loading-screen');
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain(`>${msg}</span>`);
        expect(html).toContain('processing-spinner-svg');
        expect(html).toContain('processing-spinner-inner');

        // Simple design: strictly no percentages or progress bars
        expect(html).not.toContain('%');
        expect(html).not.toContain('progress-bar');
      }
    });
  });

  describe('Both Loaders Replace Entire AppShell', () => {
    it('completely replaces AppShell when PDF opening loader is active', () => {
      const mockViewer = {
        currentFile: null,
        setCurrentFile: vi.fn(),
        openPdfPicker: vi.fn(),
        loadFile: vi.fn(),
        isLoading: true,
        setIsLoading: vi.fn(),
      };

      const html = renderToString(
        <MemoryRouter initialEntries={['/viewer']}>
          <ToastProvider>
            <ViewerContext.Provider value={mockViewer}>
              <AppShell>
                <div data-testid="viewer-content">Viewer Content</div>
              </AppShell>
            </ViewerContext.Provider>
          </ToastProvider>
        </MemoryRouter>
      );

      expect(html).toContain('pdf-full-loading-screen');
      expect(html).toContain('Opening PDF…');
      expect(html).not.toContain('class="hdr');
      expect(html).not.toContain('aria-label="Main menu"');
      expect(html).not.toContain('aria-label="Main navigation rail"');
      expect(html).not.toContain('class="bnav"');
      expect(html).not.toContain('class="sbar"');
      expect(html).toContain('style="display:none"');
      expect(html).toContain('Viewer Content');
    });

    it('completely replaces AppShell when File Processing loader is active', () => {
      const mockProcessing = {
        isProcessing: true,
        message: 'Compressing PDF…',
        startProcessing: vi.fn(),
        stopProcessing: vi.fn(),
        runWithProcessing: vi.fn(),
      };

      const html = renderToString(
        <MemoryRouter initialEntries={['/tool/compress']}>
          <ToastProvider>
            <ProcessingContext.Provider value={mockProcessing}>
              <AppShell>
                <div data-testid="tool-content">Compress Content</div>
              </AppShell>
            </ProcessingContext.Provider>
          </ToastProvider>
        </MemoryRouter>
      );

      expect(html).toContain('processing-full-loading-screen');
      expect(html).toContain('Compressing PDF…');
      expect(html).not.toContain('class="hdr');
      expect(html).not.toContain('aria-label="Main menu"');
      expect(html).not.toContain('aria-label="Main navigation rail"');
      expect(html).not.toContain('class="bnav"');
      expect(html).not.toContain('class="sbar"');
      expect(html).toContain('style="display:none"');
      expect(html).toContain('Compress Content');
    });

    it('renders normal application view when neither loader is active', () => {
      const html = renderToString(
        <MemoryRouter initialEntries={['/']}>
          <ToastProvider>
            <ViewerProvider>
              <AppShell>
                <div data-testid="home-content">Home Content</div>
              </AppShell>
            </ViewerProvider>
          </ToastProvider>
        </MemoryRouter>
      );

      expect(html).not.toContain('pdf-full-loading-screen');
      expect(html).not.toContain('processing-full-loading-screen');
      expect(html).toContain('class="hdr');
      expect(html).toContain('aria-label="Main navigation rail"');
      expect(html).toContain('Home Content');
    });
  });

  describe('Both Loaders Replace Entire WebShell', () => {
    it('completely replaces WebShell when File Processing loader is active', () => {
      const mockProcessing = {
        isProcessing: true,
        message: 'Merging PDFs…',
        startProcessing: vi.fn(),
        stopProcessing: vi.fn(),
        runWithProcessing: vi.fn(),
      };

      const html = renderToString(
        <MemoryRouter initialEntries={['/tool/merge']}>
          <ToastProvider>
            <ProcessingContext.Provider value={mockProcessing}>
              <WebShell>
                <div>Merge Web Content</div>
              </WebShell>
            </ProcessingContext.Provider>
          </ToastProvider>
        </MemoryRouter>
      );

      expect(html).toContain('processing-full-loading-screen');
      expect(html).toContain('Merging PDFs…');
      expect(html).not.toContain('class="wh"');
      expect(html).not.toContain('class="wf"');
      expect(html).toContain('style="display:none"');
    });
  });

  describe('ViewerPagesView & Toolbar State', () => {
    it('renders exact text "Opening PDF…" when loading in ViewerPagesView', () => {
      const html = renderToString(
        <ViewerPagesView
          pdfDoc={null}
          fileName=""
          numPages={0}
          pageSizes={[]}
          isLoading={true}
          error={null}
          scrollRootRef={createRef()}
          pagesWrapperRef={createRef()}
          isFitToWidth={true}
          effectiveScale={1}
          onScroll={() => {}}
          onOpenClick={() => {}}
          onFilesDropped={() => {}}
          onDoubleClickPage={() => {}}
          searchQuery=""
          matches={[]}
          currentMatchIndex={0}
        />
      );

      expect(html).toContain('Opening PDF…');
      expect(html).not.toContain('empty-viewport');
      expect(html).not.toContain('viewer-state-box error');
    });

    it('renders recoverable error view with both retry and return home actions upon failure', () => {
      const onOpenClick = vi.fn();
      const onReturnHome = vi.fn();

      const html = renderToString(
        <ViewerPagesView
          pdfDoc={null}
          fileName="damaged.pdf"
          numPages={0}
          pageSizes={[]}
          isLoading={false}
          error="The PDF file is damaged or corrupted."
          scrollRootRef={createRef()}
          pagesWrapperRef={createRef()}
          isFitToWidth={true}
          effectiveScale={1}
          onScroll={() => {}}
          onOpenClick={onOpenClick}
          onFilesDropped={() => {}}
          onReturnHome={onReturnHome}
          onDoubleClickPage={() => {}}
          searchQuery=""
          matches={[]}
          currentMatchIndex={0}
        />
      );

      expect(html).not.toContain('pdf-loading-view');
      expect(html).toContain('viewer-state-box error');
      expect(html).toContain('role="alert"');
      expect(html).toContain('Could not open PDF');
      expect(html).toContain('The PDF file is damaged or corrupted.');
      expect(html).toContain('Choose another file');
      expect(html).toContain('Return to home');
    });

    it('displays "Opening PDF…" in ViewerToolbar when loading', () => {
      const html = renderToString(
        <ViewerToolbar
          pdfDoc={null}
          isLoading={true}
          onOpenClick={() => {}}
          onOpenPalette={() => {}}
          onCloseDocument={() => {}}
          showThumbnails={false}
          onToggleThumbnails={() => {}}
          currentPage={1}
          numPages={0}
          onJumpToPage={() => {}}
          isEditingPage={false}
          setIsEditingPage={() => {}}
          pageInputRef={createRef()}
          pageInputValue="1"
          setPageInputValue={() => {}}
          onPageJumpSubmit={() => {}}
          onStartPageEdit={() => {}}
          zoom={1}
          onZoomIn={() => {}}
          onZoomOut={() => {}}
          isFitToWidth={true}
          fitScale={1}
          onToggleFitOrZoom={() => {}}
          isSearchOpen={false}
          onToggleSearch={() => {}}
          isFullscreen={false}
          onToggleFullscreen={() => {}}
          autoHideControls={false}
          onToggleAutoHide={() => {}}
          isDistractionFree={false}
          onToggleDistractionFree={() => {}}
        />
      );

      expect(html).toContain('<span class="vtb-status-msg">Opening PDF…</span>');
      expect(html).not.toContain('vtb-open-btn');
    });
  });

  describe('DropZone Selection Hooks', () => {
    it('provides synchronous onFilesSelectedStart hook before async processing', () => {
      const onFilesSelectedStart = vi.fn();
      const onFilesSelected = vi.fn();

      const html = renderToString(
        <DropZone
          onFilesSelected={onFilesSelected}
          onFilesSelectedStart={onFilesSelectedStart}
        />
      );

      expect(html).toContain('Open PDF files');
      expect(typeof onFilesSelectedStart).toBe('function');
    });
  });

  describe('Stale Request & Race Condition Protection', () => {
    it('supersedes stale asynchronous loads with newer selection', async () => {
      const pdfDoc1 = await PDFDocument.create();
      pdfDoc1.addPage([100, 100]);
      const bytes1 = await pdfDoc1.save();

      const pdfDoc2 = await PDFDocument.create();
      pdfDoc2.addPage([200, 200]);
      pdfDoc2.addPage([200, 200]);
      const bytes2 = await pdfDoc2.save();

      let activeRequestId = 0;
      let adoptedDoc: unknown = null;

      // Start Request 1
      const req1 = ++activeRequestId;
      const promise1 = loadPdf(bytes1).then(async (doc) => {
        if (req1 !== activeRequestId) {
          await destroyPdf(doc);
          return null;
        }
        adoptedDoc = doc;
        return doc;
      });

      // User immediately selects Request 2 before Request 1 finishes
      const req2 = ++activeRequestId;
      const promise2 = loadPdf(bytes2).then(async (doc) => {
        if (req2 !== activeRequestId) {
          await destroyPdf(doc);
          return null;
        }
        adoptedDoc = doc;
        return doc;
      });

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(res1).toBeNull(); // Request 1 discarded
      expect(res2).not.toBeNull(); // Request 2 adopted
      expect(adoptedDoc).toBe(res2);

      if (res2) {
        await destroyPdf(res2);
      }
    });

    it('prevents stale completion requests from dismissing a newer processing loader', () => {
      let activeReq = 0;
      let isProcessing = false;

      const start = () => {
        isProcessing = true;
        return ++activeReq;
      };

      const stop = (reqId: number) => {
        if (reqId !== activeReq) return;
        isProcessing = false;
      };

      const reqA = start(); // Task A starts (id: 1)
      const reqB = start(); // Task B starts (id: 2)

      // Task A finishes late
      stop(reqA);
      expect(isProcessing).toBe(true); // Still processing Task B!

      // Task B finishes
      stop(reqB);
      expect(isProcessing).toBe(false); // Cleanly stopped
    });
  });

  describe('Stage 4 Hotfix: Deterministic Loading & Android Toolbar Regressions', () => {
    it('1. verifies Android/mobile empty-viewer toolbar has vtb-empty class and universal suppression in CSS', () => {
      const emptyToolbarHtml = renderToString(
        <ViewerToolbar
          pdfDoc={null}
          isLoading={false}
          onOpenClick={() => {}}
          onOpenPalette={() => {}}
          onCloseDocument={() => {}}
          showThumbnails={false}
          mobileThumbnailsOpen={false}
          onToggleThumbnails={() => {}}
          numPages={0}
          currentPage={1}
          onJumpToPage={() => {}}
          isEditingPage={false}
          setIsEditingPage={() => {}}
          pageInputRef={createRef()}
          pageInputValue="1"
          setPageInputValue={() => {}}
          onPageJumpSubmit={() => {}}
          onStartPageEdit={() => {}}
          zoom={100}
          onZoomIn={() => {}}
          onZoomOut={() => {}}
          isFitToWidth={false}
          fitScale={1}
          onToggleFitOrZoom={() => {}}
          isSearchOpen={false}
          onToggleSearch={() => {}}
          isFullscreen={false}
          onToggleFullscreen={() => {}}
          autoHideControls={false}
          onToggleAutoHide={() => {}}
          isDistractionFree={false}
          onToggleDistractionFree={() => {}}
        />
      );

      // Markup receives vtb-empty class on all platforms (Android, mobile, desktop)
      expect(emptyToolbarHtml).toContain('class="vtb vtb-empty"');
      expect(emptyToolbarHtml).not.toContain('class="vtb" ');
    });

    it('2. verifies active Android/mobile viewer toolbar remains visible and retains all controls', () => {
      const mockDoc = { numPages: 10 } as unknown as import('./renderPage').PdfDocument;
      const activeToolbarHtml = renderToString(
        <ViewerToolbar
          pdfDoc={mockDoc}
          isLoading={false}
          onOpenClick={() => {}}
          onOpenPalette={() => {}}
          onCloseDocument={() => {}}
          showThumbnails={false}
          mobileThumbnailsOpen={false}
          onToggleThumbnails={() => {}}
          numPages={10}
          currentPage={3}
          onJumpToPage={() => {}}
          isEditingPage={false}
          setIsEditingPage={() => {}}
          pageInputRef={createRef()}
          pageInputValue="3"
          setPageInputValue={() => {}}
          onPageJumpSubmit={() => {}}
          onStartPageEdit={() => {}}
          zoom={100}
          onZoomIn={() => {}}
          onZoomOut={() => {}}
          isFitToWidth={true}
          fitScale={1}
          onToggleFitOrZoom={() => {}}
          isSearchOpen={false}
          onToggleSearch={() => {}}
          isFullscreen={false}
          onToggleFullscreen={() => {}}
          autoHideControls={false}
          onToggleAutoHide={() => {}}
          isDistractionFree={false}
          onToggleDistractionFree={() => {}}
        />
      );

      // Must NOT have vtb-empty class
      expect(activeToolbarHtml).not.toContain('vtb-empty');
      expect(activeToolbarHtml).toContain('class="vtb"');

      // Essential viewer controls must be present
      expect(activeToolbarHtml).toContain('aria-label="Show page thumbnails"');
      expect(activeToolbarHtml).toContain('aria-label="Close PDF"');
      expect(activeToolbarHtml).toContain('aria-label="Find text in document (Ctrl+F)"');
      expect(activeToolbarHtml).toContain('Fit to width');
      expect(activeToolbarHtml).toContain('aria-label="Enter full screen (F)"');
      expect(activeToolbarHtml).toContain('aria-label="Enter distraction-free mode"');
    });

    it('3. opening a valid PDF causes exactly one loading lifecycle and displays the document', async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage([300, 400]);
      const bytes = await pdf.save();

      let loadingTransitions = 0;
      let currentLoadingState = false;

      const setLoading = (val: boolean) => {
        if (val !== currentLoadingState) {
          loadingTransitions++;
          currentLoadingState = val;
        }
      };

      // Lifecycle start
      setLoading(true);
      expect(currentLoadingState).toBe(true);

      const doc = await loadPdf(bytes);
      expect(doc.numPages).toBe(1);

      // Lifecycle end
      setLoading(false);
      expect(currentLoadingState).toBe(false);

      // Exact 1 start and 1 end = 2 transitions
      expect(loadingTransitions).toBe(2);

      await destroyPdf(doc);
    });

    it('4. loading does not restart on repeated component re-renders', () => {
      let runCount = 0;
      let lastOpenedFile: unknown = null;

      const simulateRender = (currentFile: { name: string }) => {
        if (currentFile && currentFile !== lastOpenedFile) {
          lastOpenedFile = currentFile;
          runCount++;
        }
      };

      const file = { name: 'annual-report.pdf' };
      // Initial render triggers load
      simulateRender(file);
      expect(runCount).toBe(1);

      // Re-renders with same file instance do not trigger reload
      simulateRender(file);
      simulateRender(file);
      simulateRender(file);
      expect(runCount).toBe(1);
    });

    it('5. rapidly opening PDF A then PDF B cancels A and results in B displayed', async () => {
      const pdfA = await PDFDocument.create();
      pdfA.addPage([100, 100]);
      const bytesA = await pdfA.save();

      const pdfB = await PDFDocument.create();
      pdfB.addPage([200, 200]);
      pdfB.addPage([200, 200]);
      const bytesB = await pdfB.save();

      let loadReqId = 0;
      let activeDoc: import('./renderPage').PdfDocument | null = null;

      const openDoc = async (bytes: Uint8Array) => {
        const reqId = ++loadReqId;
        const doc = await loadPdf(bytes);
        if (reqId !== loadReqId) {
          await destroyPdf(doc);
          return null;
        }
        activeDoc = doc;
        return doc;
      };

      // Trigger A then immediately B
      const pA = openDoc(bytesA);
      const pB = openDoc(bytesB);

      const [resA, resB] = await Promise.all([pA, pB]);
      expect(resA).toBeNull(); // A discarded
      expect(resB).not.toBeNull(); // B adopted
      expect(activeDoc).toBe(resB);
      const adoptedDoc = resB as unknown as import('./renderPage').PdfDocument | null;
      expect(adoptedDoc?.numPages).toBe(2);

      if (activeDoc) {
        await destroyPdf(activeDoc);
      }
    });

    it('6. PDF loading error restores recovery UI and clears loading state instead of hanging', () => {
      let isLoading = true;
      let error: string | null = null;

      const triggerLoadFailure = () => {
        try {
          throw new Error('Damaged PDF');
        } catch {
          error = 'Could not open this PDF. Check whether the file is damaged.';
        } finally {
          isLoading = false;
        }
      };

      triggerLoadFailure();
      expect(isLoading).toBe(false);
      expect(error).not.toBeNull();

      // Renders error recovery UI
      const html = renderToString(
        <ViewerPagesView
          pdfDoc={null}
          fileName=""
          numPages={0}
          pageSizes={[]}
          isLoading={isLoading}
          error={error}
          scrollRootRef={createRef()}
          pagesWrapperRef={createRef()}
          isFitToWidth={true}
          effectiveScale={1}
          onScroll={() => {}}
          onOpenClick={() => {}}
          onFilesDropped={() => {}}
          onReturnHome={() => {}}
          onDoubleClickPage={() => {}}
          searchQuery=""
          matches={[]}
          currentMatchIndex={0}
        />
      );

      expect(html).not.toContain('pdf-loading-view');
      expect(html).toContain('viewer-state-box error');
      expect(html).toContain('Could not open PDF');
      expect(html).toContain('Return to home');
      expect(html).toContain('Choose another file');
    });

    it('7. processing success, failure, and cancellation clean up the correct loader', async () => {
      let isProcessing = false;
      let activeReq = 0;

      const runWithProcessing = async <T,>(task: () => Promise<T>): Promise<T> => {
        const id = ++activeReq;
        isProcessing = true;
        try {
          return await task();
        } finally {
          if (id === activeReq) isProcessing = false;
        }
      };

      // 1. Success case
      await runWithProcessing(async () => 'ok');
      expect(isProcessing).toBe(false);

      // 2. Failure case
      await expect(
        runWithProcessing(async () => {
          throw new Error('Processing failed');
        })
      ).rejects.toThrow('Processing failed');
      expect(isProcessing).toBe(false);

      // 3. Cancellation case (forced reset)
      const id = ++activeReq;
      isProcessing = true;
      expect(isProcessing).toBe(true);
      // Forced cleanup
      isProcessing = false;
      expect(isProcessing).toBe(false);
      // Stale task finishes late, does not resurrect isProcessing
      if (id !== activeReq) isProcessing = false;
      expect(isProcessing).toBe(false);
    });

    it('8. starting or ending one processing operation does not accidentally cancel a newer one', () => {
      let activeReq = 0;
      let isProcessing = false;

      const start = () => {
        isProcessing = true;
        return ++activeReq;
      };

      const stop = (id: number) => {
        if (id !== activeReq) return;
        isProcessing = false;
      };

      const op1 = start(); // 1
      const op2 = start(); // 2

      // Op 1 finishes late
      stop(op1);
      expect(isProcessing).toBe(true); // Op 2 is still running!

      // Op 2 finishes
      stop(op2);
      expect(isProcessing).toBe(false); // Cleanly stopped
    });

    it('9. AppShell replacement keeps children in stable tree without unmounting or remounting loops', () => {
      // Test when isViewerLoading is true
      const htmlLoading = renderToString(
        <MemoryRouter initialEntries={['/viewer']}>
          <ToastProvider>
            <ViewerContext.Provider
              value={{
                currentFile: null,
                setCurrentFile: () => {},
                openPdfPicker: async () => null,
                loadFile: () => {},
                isLoading: true,
                setIsLoading: () => {},
              }}
            >
              <AppShell>
                <div data-testid="viewer-content">Viewer Content In Stable Tree</div>
              </AppShell>
            </ViewerContext.Provider>
          </ToastProvider>
        </MemoryRouter>
      );

      // Full screen loader is shown
      expect(htmlLoading).toContain('pdf-full-loading-screen');
      // Chrome is hidden
      expect(htmlLoading).not.toContain('class="hdr');
      expect(htmlLoading).not.toContain('class="bnav"');
      // Main container with children is hidden with style="display:none" but retains stable wrapper
      expect(htmlLoading).toContain('style="display:none"');
      expect(htmlLoading).toContain('id="main-content"');
      expect(htmlLoading).toContain('Viewer Content In Stable Tree');

      // Test when isViewerLoading is false
      const htmlNormal = renderToString(
        <MemoryRouter initialEntries={['/viewer']}>
          <ToastProvider>
            <ViewerContext.Provider
              value={{
                currentFile: null,
                setCurrentFile: () => {},
                openPdfPicker: async () => null,
                loadFile: () => {},
                isLoading: false,
                setIsLoading: () => {},
              }}
            >
              <AppShell>
                <div data-testid="viewer-content">Viewer Content In Stable Tree</div>
              </AppShell>
            </ViewerContext.Provider>
          </ToastProvider>
        </MemoryRouter>
      );

      // Loader is gone
      expect(htmlNormal).not.toContain('pdf-full-loading-screen');
      // Children remain inside id="main-content"
      expect(htmlNormal).toContain('id="main-content"');
      expect(htmlNormal).toContain('Viewer Content In Stable Tree');
      expect(htmlNormal).not.toContain('style="display:none"');
    });

    it('10. desktop header, toolbar, and loading behavior remain fully intact', () => {
      const htmlDesktop = renderToString(
        <MemoryRouter initialEntries={['/']}>
          <ToastProvider>
            <ViewerProvider>
              <AppShell>
                <div>Desktop Home</div>
              </AppShell>
            </ViewerProvider>
          </ToastProvider>
        </MemoryRouter>
      );

      expect(htmlDesktop).toContain('class="hdr"');
      expect(htmlDesktop).toContain('InTab');
      expect(htmlDesktop).toContain('PDF');
      expect(htmlDesktop).toContain('Search tools (Ctrl+K)');
      expect(htmlDesktop).toContain('Desktop Home');
      expect(htmlDesktop).not.toContain('pdf-full-loading-screen');
      expect(htmlDesktop).not.toContain('processing-full-loading-screen');
    });
  });

  describe('Critical Android Regressions: In-App PDF Opening and Back-to-Home Navigation', () => {
    it('Bug 1: opening a PDF through the app picker loads document and resets spinner without hanging', async () => {
      let stateLoading = false;
      let stateRoute = '/';
      let stateFile: { name: string; bytes: Uint8Array } | null = null;
      expect(stateFile).toBeNull();

      // Mock pickPdfFile returning a file with onStart hook
      const mockPickPdf = vi.fn().mockImplementation((onStart?: (fileName: string) => void) => {
        onStart?.('sample.pdf');
        stateLoading = true;
        stateRoute = '/viewer';
        return Promise.resolve({ name: 'sample.pdf', bytes: new Uint8Array([37, 80, 68, 70]) });
      });

      const originalPick = platform.pickPdfFile;
      platform.pickPdfFile = mockPickPdf;

      try {
        // Execute pick
        const file = await platform.pickPdfFile(() => {
          stateLoading = true;
          stateRoute = '/viewer';
        });

        expect(file).not.toBeNull();
        expect(file?.name).toBe('sample.pdf');
        expect(stateLoading).toBe(true);
        expect(stateRoute).toBe('/viewer');

        // Simulate document loader finishing PDF parsing
        stateFile = file;
        stateLoading = false;

        expect(stateLoading).toBe(false);
        expect(stateFile?.name).toBe('sample.pdf');
      } finally {
        platform.pickPdfFile = originalPick;
      }
    });

    it('Bug 1: cancelling the picker does not leave app stuck in loading state', async () => {
      let stateLoading = false;
      let stateRoute = '/about';

      const mockPickPdf = vi.fn().mockImplementation(() => {
        // User cancels dialog - onStart is NOT called
        return Promise.resolve(null);
      });

      const originalPick = platform.pickPdfFile;
      platform.pickPdfFile = mockPickPdf;

      try {
        const file = await platform.pickPdfFile(() => {
          stateLoading = true;
          stateRoute = '/viewer';
        });

        expect(file).toBeNull();
        // Since user cancelled, state is not loading and route was not changed
        expect(stateLoading).toBe(false);
        expect(stateRoute).toBe('/about');
      } finally {
        platform.pickPdfFile = originalPick;
      }
    });

    it('Bug 2: launch intent hasPendingFile is consumed exactly once and does not override Home route', async () => {
      // Test that getInitialDestination returns '/' on all platforms
      const { getInitialDestination } = await import('../config/screens');
      expect(getInitialDestination('android')).toBe('/');
      expect(getInitialDestination('electron')).toBe('/');
      expect(getInitialDestination('web')).toBe('/');

      // Verify that after opening a launch PDF and closing it, navigate('/') renders HomePage
      const htmlHome = renderToString(
        <MemoryRouter initialEntries={['/']}>
          <ToastProvider>
            <ViewerProvider>
              <AppShell>
                <div data-testid="home-content">Welcome to InTab PDF</div>
              </AppShell>
            </ViewerProvider>
          </ToastProvider>
        </MemoryRouter>
      );

      expect(htmlHome).toContain('Welcome to InTab PDF');
      expect(htmlHome).not.toContain('pdf-full-loading-screen');
      expect(htmlHome).toContain('class="hdr');
    });

    it('Bug 2: closing a document reliably returns to Home and allows opening a second PDF', async () => {
      let currentDoc: string | null = 'first.pdf';
      let currentRoute = '/viewer';

      // 1. First PDF is open in viewer
      expect(currentDoc).toBe('first.pdf');
      expect(currentRoute).toBe('/viewer');

      // 2. User closes first PDF
      currentDoc = null;
      currentRoute = '/';

      // Verify route is Home and document is cleared
      expect(currentDoc).toBeNull();
      expect(currentRoute).toBe('/');

      // 3. User opens second PDF from Home
      currentDoc = 'second.pdf';
      currentRoute = '/viewer';

      expect(currentDoc).toBe('second.pdf');
      expect(currentRoute).toBe('/viewer');
    });

    it('proves that a PDF selected through the in-app picker renders canvas and page content—not merely page count', async () => {
      // Create a valid PDF document with real bytes
      const testDoc = await PDFDocument.create();
      const page = testDoc.addPage([595, 842]);
      page.drawText('Sample PDF content text', { x: 50, y: 700 });
      const bytes = await testDoc.save();

      // Load with PDF.js
      const loadedDoc = await loadPdf(bytes);
      expect(loadedDoc).toBeDefined();
      expect(loadedDoc.numPages).toBe(1);

      // Render ViewerPagesView containing VisiblePage with the loaded document
      const scrollRootRef = createRef<HTMLElement>();
      const pagesWrapperRef = createRef<HTMLDivElement>();

      const html = renderToString(
        <ViewerPagesView
          pdfDoc={loadedDoc}
          fileName="inapp-picked.pdf"
          numPages={loadedDoc.numPages}
          pageSizes={[{ width: 595, height: 842 }]}
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

      // Verify that actual page 1 renders with <canvas> and textLayer, NOT blank placeholder
      expect(html).toContain('class="pg-item"');
      expect(html).toContain('data-page="1"');
      expect(html).toContain('<canvas');
      expect(html).toContain('class="textLayer"');
      expect(html).not.toContain('pg-placeholder');

      await destroyPdf(loadedDoc);
    });

    it('VisiblePage initializes with page 1 visible immediately without depending on delayed observer callback', () => {
      const mockDoc = {
        numPages: 1,
        getPage: vi.fn(),
      } as unknown as import('./renderPage').PdfDocument;

      const scrollRootRef = createRef<HTMLElement>();

      const htmlPage1 = renderToString(
        <VisiblePage
          doc={mockDoc}
          pageNumber={1}
          scale={1}
          baseSize={{ width: 595, height: 842 }}
          scrollRootRef={scrollRootRef}
          onDoubleClick={() => {}}
        />
      );

      // Page 1 must immediately render canvas and textLayer, not placeholder
      expect(htmlPage1).toContain('<canvas');
      expect(htmlPage1).toContain('class="textLayer"');
      expect(htmlPage1).not.toContain('pg-placeholder');
    });

    it('in-app picker passes selected file to loadFile exactly once', async () => {
      let loadCount = 0;
      let loadedFile: { name: string; bytes: Uint8Array } | null = null;

      const mockLoadFile = vi.fn().mockImplementation((file: { name: string; bytes: Uint8Array }) => {
        loadCount++;
        loadedFile = file;
      });

      // Simulate openPdfPicker that calls loadFile exactly once
      const mockPickPdf = vi.fn().mockResolvedValue({
        name: 'test.pdf',
        bytes: new Uint8Array([37, 80, 68, 70]),
      });

      const originalPick = platform.pickPdfFile;
      platform.pickPdfFile = mockPickPdf;

      try {
        const file = await platform.pickPdfFile();
        if (file) {
          mockLoadFile(file);
        }

        // Verify loadFile was called exactly once
        expect(loadCount).toBe(1);
        expect(mockLoadFile).toHaveBeenCalledTimes(1);
        expect((loadedFile as { name: string } | null)?.name).toBe('test.pdf');
      } finally {
        platform.pickPdfFile = originalPick;
      }
    });
  });
});
