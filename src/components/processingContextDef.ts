// Context definition for the global file-processing loader across InTabPDF.
import { createContext } from 'react';

export interface ProcessingContextType {
  isProcessing: boolean;
  isCancelling?: boolean;
  message: string;
  startProcessing: (message: string) => number;
  stopProcessing: (requestId?: number) => void;
  updateMessage?: (message: string) => void;
  runWithProcessing: <T>(message: string, task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  cancelProcessing?: () => void;
  cancelHandler?: (() => void) | null;
  setCancelHandler?: (handler: (() => void) | null) => void;
}

export const ProcessingContext = createContext<ProcessingContextType | null>(null);
