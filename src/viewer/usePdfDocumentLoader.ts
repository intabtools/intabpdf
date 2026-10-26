// Custom hook managing PDF document loading, parsing, page dimensions, and resource cleanup.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
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

export interface UsePdfDocumentLoaderResult {
  pdfDoc: PdfDocument | null;
  fileName: string;
  pageSizes: PageSize[];
  currentPage: number;
  setCurrentPage: (page: number) => void;
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
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
  } = useViewer();

  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [internalLoading, setInternalLoading] = useState(() => Boolean(currentFile && !pdfDoc));
  const [error, setError] = useState<string | null>(null);

  const setLoading = useCallback(
    (loading: boolean) => {
      setInternalLoading(loading);
      setContextLoading(loading);
    },
    [setContextLoading]
  );

  const isLoading = contextLoading || internalLoading;

  const loadRequestRef = useRef(0);
  const lastOpenedFileRef = useRef<OpenedFile | null>(null);

  const openDocument = useCallback(
    async (file: OpenedFile) => {
      const requestId = ++loadRequestRef.current;
      let doc: PdfDocument | null = null;
      let adopted = false;
      setPdfDoc(null);
      setPageSizes([]);
      setFileName(file.name);
      setCurrentPage(1);
      setLoading(true);
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
        }
      } finally {
        if (requestId === loadRequestRef.current) {
          setLoading(false);
        }
      }
    },
    [setLoading]
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
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void destroyPdf(pdfDoc).catch(() => undefined);
      }
    };
  }, [pdfDoc]);

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
    if (pdfDoc) {
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
  }, [pdfDoc, setCurrentFile, setLoading]);

  return {
    pdfDoc,
    fileName,
    pageSizes,
    currentPage,
    setCurrentPage,
    isLoading,
    setLoading,
    error,
    openDocument,
    handleOpenClick,
    handleFilesDropped,
    handleDrop,
    resetDocumentState,
  };
}
