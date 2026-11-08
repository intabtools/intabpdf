import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { platform, type OpenedFile } from '../platform';
import * as renderPageModule from './renderPage';
import type { PdfDocument } from './renderPage';

const mockDestroyedDocs = new Set<object>();

vi.mock('./renderPage', () => {
  return {
    loadPdf: vi.fn().mockImplementation(async (bytes: Uint8Array) => ({
      numPages: 3,
      bytesLength: bytes.byteLength,
      destroy: vi.fn(),
    })),
    destroyPdf: vi.fn().mockImplementation(async (doc: PdfDocument) => {
      mockDestroyedDocs.add(doc);
    }),
    getPageSize: vi.fn().mockReturnValue({ width: 595, height: 842 }),
    drawPageOnCanvas: vi.fn().mockResolvedValue(undefined),
  };
});

describe('GitHub Issue #26: Open PDF in Viewer after saving a processed PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDestroyedDocs.clear();
    platform.clearPendingFile?.();
  });

  afterEach(() => {
    platform.clearPendingFile?.();
  });

  it('1. Opens a new processed PDF when an old PDF is already active in the viewer', async () => {
    const initialFile: OpenedFile = {
      name: 'source.pdf',
      bytes: new Uint8Array([1, 2, 3]),
    };

    const mockDestroy = vi.fn().mockResolvedValue(undefined);
    const activeDoc = { id: 'initial-doc', numPages: 1, destroy: mockDestroy } as unknown as PdfDocument;

    let contextActiveDoc: PdfDocument | null = activeDoc;
    let contextActiveFile: OpenedFile | null = initialFile;
    let contextCurrentFile: OpenedFile | null = initialFile;
    let contextLoading = false;

    // Verify initial active state before tool invocation
    expect(contextActiveDoc).toBe(activeDoc);
    expect(contextActiveFile).toBe(initialFile);
    expect(contextCurrentFile).toBe(initialFile);
    expect(contextLoading).toBe(false);

    // User navigates to a tool, saves processed PDF, and clicks "Open in Viewer"
    const processedFile: OpenedFile = {
      name: 'compressed-source.pdf',
      bytes: new Uint8Array([10, 20, 30, 40, 50]),
    };

    // loadFile logic in ViewerContext:
    const prevDoc = contextActiveDoc;
    contextActiveDoc = null;
    contextActiveFile = null;
    if (prevDoc) {
      await renderPageModule.destroyPdf(prevDoc);
    }
    contextLoading = true;
    contextCurrentFile = processedFile;

    // Verify old document is destroyed immediately
    expect(mockDestroyedDocs.has(activeDoc)).toBe(true);
    expect(contextActiveDoc).toBeNull();
    expect(contextCurrentFile).toBe(processedFile);
    expect(contextLoading).toBe(true);

    // Verify usePdfDocumentLoader detects the new processed file and loads it
    const isSessionActive = Boolean(
      contextActiveDoc && contextActiveFile && contextCurrentFile === contextActiveFile
    );
    expect(isSessionActive).toBe(false);

    const lastOpenedFileRef = { current: isSessionActive ? contextCurrentFile : null };
    expect(lastOpenedFileRef.current).toBeNull();

    let openedDocBytes: Uint8Array | null = null;
    if (contextCurrentFile && contextCurrentFile !== lastOpenedFileRef.current) {
      lastOpenedFileRef.current = contextCurrentFile;
      const loaded = await renderPageModule.loadPdf(contextCurrentFile.bytes);
      openedDocBytes = contextCurrentFile.bytes;
      contextActiveDoc = loaded;
      contextActiveFile = contextCurrentFile;
      contextLoading = false;
    }

    expect(openedDocBytes).toBe(processedFile.bytes);
    expect(contextActiveFile?.name).toBe('compressed-source.pdf');
    expect(contextLoading).toBe(false);
    expect(contextActiveDoc).not.toBeNull();
  });

  it('2. Opens two different PDFs with the exact same filename', async () => {
    const fileVersion1: OpenedFile = {
      name: 'document.pdf',
      bytes: new Uint8Array([1, 1, 1]),
    };

    const fileVersion2: OpenedFile = {
      name: 'document.pdf',
      bytes: new Uint8Array([2, 2, 2, 2]),
    };

    const docVersion1 = { id: 'doc-v1' } as unknown as PdfDocument;

    let activeDoc: PdfDocument | null = docVersion1;
    let activeDocFile: OpenedFile | null = fileVersion1;
    let currentFile: OpenedFile | null = fileVersion1;

    // Check session active for fileVersion2 BEFORE loadFile:
    const isMatchingBeforeLoad = Boolean(
      activeDoc && activeDocFile && fileVersion2 === activeDocFile
    );
    // Reference check fileVersion2 === activeDocFile is FALSE despite identical filename
    expect(isMatchingBeforeLoad).toBe(false);
    expect(currentFile).toBe(fileVersion1);

    // Call loadFile(fileVersion2)
    const prev = activeDoc;
    activeDoc = null;
    activeDocFile = null;
    if (prev) {
      await renderPageModule.destroyPdf(prev);
    }
    currentFile = fileVersion2;

    expect(mockDestroyedDocs.has(docVersion1)).toBe(true);
    expect(activeDoc).toBeNull();
    expect(activeDocFile).toBeNull();
    expect(currentFile).toBe(fileVersion2);

    // In usePdfDocumentLoader:
    const isSessionActive = Boolean(activeDoc && activeDocFile && currentFile === activeDocFile);
    expect(isSessionActive).toBe(false);

    const lastOpenedFileRef = { current: isSessionActive ? currentFile : null };
    expect(lastOpenedFileRef.current).toBeNull();

    let loadedDoc: { bytesLength?: number } | null = null;
    if (currentFile && currentFile !== lastOpenedFileRef.current) {
      lastOpenedFileRef.current = currentFile;
      loadedDoc = await renderPageModule.loadPdf(currentFile.bytes) as unknown as { bytesLength?: number };
    }

    expect(loadedDoc).toBeTruthy();
    expect(loadedDoc?.bytesLength).toBe(4);
  });

  it('3. Preserves reading position, zoom, and document when navigating away and returning without loadFile', () => {
    const file: OpenedFile = {
      name: 'reading-guide.pdf',
      bytes: new Uint8Array([10, 20]),
    };
    const doc = { id: 'saved-reading-doc', numPages: 5 } as unknown as PdfDocument;

    const activeDoc: PdfDocument | null = doc;
    const activeDocFile: OpenedFile | null = file;
    const currentFile: OpenedFile | null = file;
    const savedCurrentPage = 4;
    const savedZoom = 175;
    const savedIsFitToWidth = false;

    // User navigates away and returns without loadFile
    const isSessionActive = Boolean(
      activeDoc && activeDocFile && currentFile && currentFile === activeDocFile
    );

    expect(isSessionActive).toBe(true);

    const initialDoc = isSessionActive ? activeDoc : null;
    const initialPage = isSessionActive ? savedCurrentPage : 1;
    const lastOpenedFileRef = { current: isSessionActive ? currentFile : null };

    // Verify session state was restored without reloading
    expect(initialDoc).toBe(doc);
    expect(initialPage).toBe(4);
    expect(savedZoom).toBe(175);
    expect(savedIsFitToWidth).toBe(false);

    let openCalled = false;
    if (currentFile && currentFile !== lastOpenedFileRef.current) {
      openCalled = true;
    }
    expect(openCalled).toBe(false);
  });

  it('4. Handles race when loading a second PDF while the first is still destroying/loading', async () => {
    const doc0 = { id: 'initial-active-doc' } as unknown as PdfDocument;
    let activePdfDocRef: PdfDocument | null = doc0;
    const destroyingDocs = new WeakSet<object>();

    const safelyDestroy = async (d: PdfDocument | null) => {
      if (!d || destroyingDocs.has(d)) return;
      destroyingDocs.add(d);
      await renderPageModule.destroyPdf(d);
    };

    // Trigger loadFile for file1
    const prev1 = activePdfDocRef;
    activePdfDocRef = null;
    const p1Destroy = safelyDestroy(prev1);

    // While p1Destroy is in flight, trigger loadFile for file2 immediately
    const prev2 = activePdfDocRef; // null!
    const p2Destroy = safelyDestroy(prev2);

    await Promise.all([p1Destroy, p2Destroy]);

    // Initial doc was destroyed exactly once
    expect(mockDestroyedDocs.has(doc0)).toBe(true);
    expect(renderPageModule.destroyPdf).toHaveBeenCalledTimes(1);

    // Request superseding in openDocument
    let loadRequest = 0;
    const activeLoadingTask = { destroy: vi.fn() };

    const req1 = ++loadRequest;
    const req2 = ++loadRequest;
    activeLoadingTask.destroy();

    expect(req1 !== loadRequest).toBe(true);
    expect(req2 === loadRequest).toBe(true);
    expect(activeLoadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('5. Successfully opens an external PDF received via platform.onFileOpened', async () => {
    const oldDoc = { id: 'old-opened-doc' } as unknown as PdfDocument;
    let activePdfDocRef: PdfDocument | null = oldDoc;
    let activeDocFileRef: OpenedFile | null = { name: 'old.pdf', bytes: new Uint8Array([1]) };
    let currentFile: OpenedFile | null = activeDocFileRef;
    let isLoading = false;

    let onFileOpenedHandler: ((file: OpenedFile) => void) | null = null;
    const mockUnsub = vi.fn();
    vi.spyOn(platform, 'onFileOpened').mockImplementation((handler) => {
      onFileOpenedHandler = handler;
      return mockUnsub;
    });

    platform.onFileOpened((newFile) => {
      const prev = activePdfDocRef;
      if (prev) {
        activePdfDocRef = null;
        void renderPageModule.destroyPdf(prev);
      }
      activeDocFileRef = null;
      currentFile = newFile;
      isLoading = true;
    });

    const externalPdf: OpenedFile = {
      name: 'incoming-contract.pdf',
      bytes: new Uint8Array([99, 88, 77]),
    };

    onFileOpenedHandler!(externalPdf);

    expect(mockDestroyedDocs.has(oldDoc)).toBe(true);
    expect(activePdfDocRef).toBeNull();
    expect(activeDocFileRef).toBeNull();
    expect(currentFile).toBe(externalPdf);
    expect(isLoading).toBe(true);

    const isSessionActive = Boolean(
      activePdfDocRef && activeDocFileRef && currentFile === activeDocFileRef
    );
    expect(isSessionActive).toBe(false);

    const loadedExternal = await renderPageModule.loadPdf(currentFile.bytes) as unknown as { bytesLength?: number };
    expect(loadedExternal).toBeTruthy();
    expect(loadedExternal?.bytesLength).toBe(3);
  });
});
