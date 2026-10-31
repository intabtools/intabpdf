import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPlatformType, platform, type OpenedFile } from '../platform';
import type { PageSize, PdfDocument } from './renderPage';
import { ViewerContext } from './viewerContextDef';

async function safelyDestroyPdf(doc: PdfDocument): Promise<void> {
  try {
    const { destroyPdf } = await import('./renderPage');
    await destroyPdf(doc).catch(() => undefined);
  } catch {
    // Ignore dynamic import failure during teardown
  }
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [currentFile, setCurrentFile] = useState<OpenedFile | null>(null);
  const [initialHasPending] = useState(() => platform.hasPendingFile?.() ?? false);
  const [isLoading, setIsLoading] = useState(initialHasPending);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);

  // Preserved viewer document & reading session state across navigation
  const [activePdfDoc, setActivePdfDoc] = useState<PdfDocument | null>(null);
  const [activeFileName, setActiveFileName] = useState('');
  const [activePageSizes, setActivePageSizes] = useState<PageSize[]>([]);
  const [savedCurrentPage, setSavedCurrentPage] = useState(1);
  const [savedZoom, setSavedZoom] = useState(100);
  const [savedIsFitToWidth, setSavedIsFitToWidth] = useState(true);

  const activePdfDocRef = useRef<PdfDocument | null>(null);
  useEffect(() => {
    activePdfDocRef.current = activePdfDoc;
  }, [activePdfDoc]);

  // Clean up PDF.js document when ViewerProvider unmounts (e.g. app shutdown or test tear-down)
  useEffect(() => {
    return () => {
      if (activePdfDocRef.current) {
        void safelyDestroyPdf(activePdfDocRef.current);
      }
    };
  }, []);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const coldStartHandledRef = useRef(false);

  // On cold start with pending file, immediately navigate to viewer exactly once
  useEffect(() => {
    if (initialHasPending && !coldStartHandledRef.current && getPlatformType() !== 'web') {
      coldStartHandledRef.current = true;
      navigate('/viewer');
    }
  }, [initialHasPending, navigate]);

  // Listen to platform file open events (e.g. Electron file associations, Android intent, drag onto dock)
  useEffect(() => {
    const unsubStart = platform.onFileOpenStart?.(() => {
      setIsLoading(true);
      if (getPlatformType() !== 'web') {
        navigateRef.current('/viewer');
      }
    });
    const unsubOpened = platform.onFileOpened((file) => {
      setIsLoading(true);
      setCurrentFile(file);
      if (getPlatformType() !== 'web') {
        navigateRef.current('/viewer');
      }
    });
    const unsubError = platform.onFileOpenError?.(() => {
      setIsLoading(false);
      if (getPlatformType() !== 'web') {
        navigateRef.current('/viewer');
      }
    });
    return () => {
      unsubStart?.();
      unsubOpened();
      unsubError?.();
    };
  }, []);

  const loadFile = useCallback(
    (file: OpenedFile) => {
      setIsLoading(true);
      setCurrentFile(file);
      if (getPlatformType() !== 'web') {
        navigate('/viewer');
      }
    },
    [navigate]
  );

  const saveViewerDocument = useCallback(
    (doc: PdfDocument, file: OpenedFile, pageSizes: PageSize[]) => {
      if (activePdfDocRef.current && activePdfDocRef.current !== doc) {
        void safelyDestroyPdf(activePdfDocRef.current);
      }
      setActivePdfDoc(doc);
      activePdfDocRef.current = doc;
      setCurrentFile(file);
      setActiveFileName(file.name);
      setActivePageSizes(pageSizes);
      setSavedCurrentPage(1);
    },
    []
  );

  const updateReadingState = useCallback(
    (state: { currentPage?: number; zoom?: number; isFitToWidth?: boolean }) => {
      if (state.currentPage !== undefined) {
        setSavedCurrentPage(state.currentPage);
      }
      if (state.zoom !== undefined) {
        setSavedZoom(state.zoom);
      }
      if (state.isFitToWidth !== undefined) {
        setSavedIsFitToWidth(state.isFitToWidth);
      }
    },
    []
  );

  const clearDocumentSession = useCallback(async () => {
    if (activePdfDocRef.current) {
      const doc = activePdfDocRef.current;
      activePdfDocRef.current = null;
      await safelyDestroyPdf(doc);
    }
    setActivePdfDoc(null);
    setCurrentFile(null);
    setActiveFileName('');
    setActivePageSizes([]);
    setSavedCurrentPage(1);
    setSavedZoom(100);
    setSavedIsFitToWidth(true);
  }, []);

  const openPdfPicker = useCallback(
    async (onStart?: (fileName: string) => void): Promise<OpenedFile | null> => {
      try {
        const file = await platform.pickPdfFile((fileName) => {
          setIsLoading(true);
          if (getPlatformType() !== 'web') {
            navigate('/viewer');
          }
          onStart?.(fileName);
        });
        if (file) {
          loadFile(file);
        } else {
          setIsLoading(false);
        }
        return file;
      } catch (err) {
        setIsLoading(false);
        console.error('Failed to pick PDF file:', err);
        return null;
      }
    },
    [loadFile, navigate]
  );

  const value = useMemo(
    () => ({
      currentFile,
      setCurrentFile,
      openPdfPicker,
      loadFile,
      isLoading,
      setIsLoading,
      pdfDoc: activePdfDoc,
      fileName: activeFileName,
      pageSizes: activePageSizes,
      currentPage: savedCurrentPage,
      zoom: savedZoom,
      isFitToWidth: savedIsFitToWidth,
      saveViewerDocument,
      updateReadingState,
      clearDocumentSession,
    }),
    [
      currentFile,
      openPdfPicker,
      loadFile,
      isLoading,
      activePdfDoc,
      activeFileName,
      activePageSizes,
      savedCurrentPage,
      savedZoom,
      savedIsFitToWidth,
      saveViewerDocument,
      updateReadingState,
      clearDocumentSession,
    ]
  );

  return (
    <ViewerContext.Provider value={value}>
      {children}
    </ViewerContext.Provider>
  );
}
