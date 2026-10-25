// Custom hook managing PDF document loading, parsing, page dimensions, and resource cleanup.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useViewer } from '../hooks/useViewer';
import type { OpenedFile } from '../platform';
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
  error: string | null;
  openDocument: (file: OpenedFile) => Promise<void>;
  handleOpenClick: () => Promise<void>;
  handleFilesDropped: (files: OpenedFile[]) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => Promise<void>;
  resetDocumentState: () => Promise<void>;
}

export function usePdfDocumentLoader(): UsePdfDocumentLoaderResult {
  const { currentFile, setCurrentFile, loadFile, openPdfPicker } = useViewer();

  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRequestRef = useRef(0);
  const lastOpenedFileRef = useRef<OpenedFile | null>(null);

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

  const resetDocumentState = useCallback(async () => {
    loadRequestRef.current += 1;
    if (pdfDoc) {
      await destroyPdf(pdfDoc).catch(() => undefined);
    }
    setPdfDoc(null);
    setFileName('');
    setPageSizes([]);
    setCurrentPage(1);
    setIsLoading(false);
    setError(null);
    setCurrentFile(null);
    lastOpenedFileRef.current = null;
  }, [pdfDoc, setCurrentFile]);

  return {
    pdfDoc,
    fileName,
    pageSizes,
    currentPage,
    setCurrentPage,
    isLoading,
    error,
    openDocument,
    handleOpenClick,
    handleFilesDropped,
    handleDrop,
    resetDocumentState,
  };
}
