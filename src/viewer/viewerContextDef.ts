import { createContext } from 'react';
import type { OpenedFile } from '../platform';
import type { PageSize, PdfDocument } from './renderPage';

export interface ViewerContextType {
  currentFile: OpenedFile | null;
  setCurrentFile: (file: OpenedFile | null) => void;
  openPdfPicker: (onStart?: (fileName: string) => void) => Promise<OpenedFile | null>;
  loadFile: (file: OpenedFile) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Preserved viewer document & reading session state across navigation
  pdfDoc?: PdfDocument | null;
  fileName?: string;
  pageSizes?: PageSize[];
  currentPage?: number;
  zoom?: number;
  isFitToWidth?: boolean;
  saveViewerDocument?: (doc: PdfDocument, file: OpenedFile, pageSizes: PageSize[]) => void;
  updateReadingState?: (state: { currentPage?: number; zoom?: number; isFitToWidth?: boolean }) => void;
  clearDocumentSession?: () => Promise<void>;
}

export const ViewerContext = createContext<ViewerContextType | null>(null);
