import { createContext } from 'react';
import type { OpenedFile } from '../platform';

export interface ViewerContextType {
  currentFile: OpenedFile | null;
  setCurrentFile: (file: OpenedFile | null) => void;
  openPdfPicker: (onStart?: (fileName: string) => void) => Promise<OpenedFile | null>;
  loadFile: (file: OpenedFile) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export const ViewerContext = createContext<ViewerContextType | null>(null);
