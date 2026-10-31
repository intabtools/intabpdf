// Custom hook managing PDF document loading, parsing, page dimensions, and resource cleanup.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import { useViewer } from '../hooks/useViewer';
import { platform, type OpenedFile } from '../platform';
import {
  destroyPdf,
  getPageSize,
  loadPdf,
  type PageSize,
  type PdfDocument,
} from './renderPage';

const DEFAULT_PAGE_SIZE: PageSize = { width: 595, height: 842 };

export interface PasswordPromptState {
  fileName: string;
  isIncorrect: boolean;
  isSubmitting: boolean;
}

export interface UsePdfDocumentLoaderResult {
  pdfDoc: PdfDocument | null;
  fileName: string;
  pageSizes: PageSize[];
  currentPage: number;
  setCurrentPage: (page: number) => void;
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  passwordPrompt: PasswordPromptState | null;
  submitPassword: (password: string) => void;
  cancelPassword: () => void;
  openDocument: (file: OpenedFile) => Promise<void>;
  handleOpenClick: () => Promise<void>;
  handleFilesDropped: (files: OpenedFile[]) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => Promise<void>;
  resetDocumentState: () => Promise<void>;
}

export function usePdfDocumentLoader(): UsePdfDocumentLoaderResult {
  const {
    currentFile,
    setCurrentFile,
    loadFile,
    openPdfPicker,
    isLoading: contextLoading,
    setIsLoading: setContextLoading,
    pdfDoc: contextPdfDoc = null,
    fileName: contextFileName = '',
    pageSizes: contextPageSizes = [],
    currentPage: contextCurrentPage = 1,
    saveViewerDocument,
    clearDocumentSession,
  } = useViewer();

  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(() => contextPdfDoc);
  const [fileName, setFileName] = useState(() => contextFileName || (currentFile ? currentFile.name : ''));
  const [pageSizes, setPageSizes] = useState<PageSize[]>(() => contextPageSizes);
  const [currentPage, setCurrentPage] = useState(() => contextCurrentPage || 1);
  const [internalLoading, setInternalLoading] = useState(
    () => Boolean(currentFile && !contextPdfDoc)
  );
  const [error, setError] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPromptState | null>(null);

  const passwordCallbackRef = useRef<((password: string | Error) => void) | null>(null);
  const activeLoadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);

  const setLoading = useCallback(
    (loading: boolean) => {
      setInternalLoading(loading);
      setContextLoading(loading);
    },
    [setContextLoading]
  );

  const isLoading = contextLoading || internalLoading;

  const loadRequestRef = useRef(0);
  const lastOpenedFileRef = useRef<OpenedFile | null>(contextPdfDoc ? currentFile : null);

  const submitPassword = useCallback((password: string) => {
    if (!passwordCallbackRef.current) return;
    setPasswordPrompt((prev) => (prev ? { ...prev, isSubmitting: true } : null));
    passwordCallbackRef.current(password);
  }, []);

  const cancelPassword = useCallback(() => {
    if (passwordCallbackRef.current) {
      try {
        passwordCallbackRef.current(new Error('Password prompt cancelled by user'));
      } catch {
        // ignore
      }
      passwordCallbackRef.current = null;
    }
    if (activeLoadingTaskRef.current) {
      void activeLoadingTaskRef.current.destroy().catch(() => undefined);
      activeLoadingTaskRef.current = null;
    }
    setPasswordPrompt(null);
    setLoading(false);
    setError(null);
    setPdfDoc(null);
    setFileName('');
    setPageSizes([]);
    void clearDocumentSession?.();
    setCurrentFile(null);
    lastOpenedFileRef.current = null;
    platform.clearPendingFile?.();
  }, [clearDocumentSession, setCurrentFile, setLoading]);

  const openDocument = useCallback(
    async (file: OpenedFile) => {
      const requestId = ++loadRequestRef.current;
      if (activeLoadingTaskRef.current) {
        void activeLoadingTaskRef.current.destroy().catch(() => undefined);
        activeLoadingTaskRef.current = null;
      }
      if (passwordCallbackRef.current) {
        try {
          passwordCallbackRef.current(new Error('Superceded by new document load'));
        } catch {
          // ignore
        }
        passwordCallbackRef.current = null;
      }
      setPasswordPrompt(null);

      let doc: PdfDocument | null = null;
      let adopted = false;
      setPdfDoc(null);
      setPageSizes([]);
      setFileName(file.name);
      setCurrentPage(1);
      setLoading(true);
      setError(null);

      try {
        doc = await loadPdf(file.bytes, {
          onLoadingTask(loadingTask) {
            if (requestId === loadRequestRef.current) {
              activeLoadingTaskRef.current = loadingTask;
            }
          },
          onPassword(updatePassword, reason) {
            if (requestId !== loadRequestRef.current) {
              try {
                updatePassword(new Error('Stale loading request'));
              } catch {
                // ignore
              }
              return;
            }
            passwordCallbackRef.current = updatePassword;
            const isIncorrect = reason === 2; // PasswordResponses.INCORRECT_PASSWORD
            setLoading(false);
            setPasswordPrompt({
              fileName: file.name,
              isIncorrect,
              isSubmitting: false,
            });
          },
        });

        if (requestId !== loadRequestRef.current) {
          void destroyPdf(doc).catch(() => undefined);
          return;
        }

        setPasswordPrompt(null);
        passwordCallbackRef.current = null;
        activeLoadingTaskRef.current = null;

        const firstSize =
          doc.numPages > 0 ? await getPageSize(doc, 1) : DEFAULT_PAGE_SIZE;

        if (requestId !== loadRequestRef.current) {
          void destroyPdf(doc).catch(() => undefined);
          return;
        }

        const initialSizes = Array.from({ length: doc.numPages }, () => firstSize);
        setPdfDoc(doc);
        adopted = true;
        setPageSizes(initialSizes);
        saveViewerDocument?.(doc, file, initialSizes);

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
          if (requestId === loadRequestRef.current) {
            setPageSizes(sizes);
            saveViewerDocument?.(activeDoc, file, sizes);
          }
        });
      } catch (loadError) {
        if (doc && !adopted) {
          void destroyPdf(doc).catch(() => undefined);
        }
        if (requestId === loadRequestRef.current) {
          activeLoadingTaskRef.current = null;
          passwordCallbackRef.current = null;
          setPasswordPrompt(null);
          setPdfDoc(null);
          setPageSizes([]);
          void clearDocumentSession?.();

          const isCancelled =
            loadError instanceof Error &&
            (loadError.message.toLowerCase().includes('cancel') ||
              loadError.name === 'AbortException' ||
              loadError.name === 'RenderingCancelledException');

          if (!isCancelled) {
            console.error('Failed to open PDF:', loadError);
            const isDamaged =
              (loadError instanceof Error && loadError.name === 'InvalidPDFException') ||
              (loadError instanceof Error && loadError.message.toLowerCase().includes('corrupt'));

            const isPasswordFail =
              loadError instanceof Error && loadError.name === 'PasswordException';

            if (isDamaged) {
              setError('Could not open this PDF. The file appears to be damaged or corrupted.');
            } else if (isPasswordFail) {
              setError('Could not decrypt this PDF. The security method may be unsupported.');
            } else {
              setError(
                'Could not open this PDF. Check whether the file is damaged, unsupported, or accessible.',
              );
            }
          } else {
            setError(null);
          }
        }
      } finally {
        if (requestId === loadRequestRef.current) {
          setLoading(false);
        }
      }
    },
    [clearDocumentSession, saveViewerDocument, setLoading]
  );

  useEffect(() => {
    return platform.onFileOpenError?.((err: string) => {
      setPdfDoc(null);
      setPageSizes([]);
      setError(err || 'Could not open this PDF. Check whether the file is damaged, unsupported, or accessible.');
      setLoading(false);
    });
  }, [setLoading]);

  useEffect(() => {
    if (currentFile && currentFile !== lastOpenedFileRef.current) {
      lastOpenedFileRef.current = currentFile;
      void openDocument(currentFile);
    }
  }, [currentFile, openDocument]);

  useEffect(() => {
    return () => {
      loadRequestRef.current += 1;
      if (activeLoadingTaskRef.current) {
        void activeLoadingTaskRef.current.destroy().catch(() => undefined);
        activeLoadingTaskRef.current = null;
      }
      if (passwordCallbackRef.current) {
        try {
          passwordCallbackRef.current(new Error('Component unmounted'));
        } catch {
          // ignore
        }
        passwordCallbackRef.current = null;
      }
      setContextLoading(false);
    };
  }, [setContextLoading]);

  const handleOpenClick = async () => {
    const file = await openPdfPicker(() => {
      setLoading(true);
      setError(null);
    });
    if (!file) {
      setLoading(false);
    }
  };

  const handleFilesDropped = (files: OpenedFile[]) => {
    if (files.length > 0) {
      setLoading(true);
      setError(null);
      loadFile(files[0]);
    } else {
      setLoading(false);
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
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

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
      setLoading(false);
    }
  };

  const resetDocumentState = useCallback(async () => {
    loadRequestRef.current += 1;
    if (activeLoadingTaskRef.current) {
      void activeLoadingTaskRef.current.destroy().catch(() => undefined);
      activeLoadingTaskRef.current = null;
    }
    if (passwordCallbackRef.current) {
      try {
        passwordCallbackRef.current(new Error('Document closed'));
      } catch {
        // ignore
      }
      passwordCallbackRef.current = null;
    }
    setPasswordPrompt(null);
    if (clearDocumentSession) {
      await clearDocumentSession();
    } else if (pdfDoc) {
      await destroyPdf(pdfDoc).catch(() => undefined);
    }
    setPdfDoc(null);
    setFileName('');
    setPageSizes([]);
    setCurrentPage(1);
    setLoading(false);
    setError(null);
    setCurrentFile(null);
    lastOpenedFileRef.current = null;
    platform.clearPendingFile?.();
  }, [clearDocumentSession, pdfDoc, setCurrentFile, setLoading]);

  return {
    pdfDoc,
    fileName,
    pageSizes,
    currentPage,
    setCurrentPage,
    isLoading,
    setLoading,
    error,
    passwordPrompt,
    submitPassword,
    cancelPassword,
    openDocument,
    handleOpenClick,
    handleFilesDropped,
    handleDrop,
    resetDocumentState,
  };
}
