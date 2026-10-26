// Context definition for the global file-processing loader across InTabPDF.
import { createContext } from 'react';

export interface ProcessingContextType {
  isProcessing: boolean;
  message: string;
  startProcessing: (message: string) => number;
  stopProcessing: (requestId?: number) => void;
  runWithProcessing: <T>(message: string, task: () => Promise<T>) => Promise<T>;
}

export const ProcessingContext = createContext<ProcessingContextType | null>(null);
