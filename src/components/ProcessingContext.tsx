// Provider managing global file-processing loading state, accurate messages, and stale request protection.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ProcessingContext, type ProcessingContextType } from './processingContextDef';

export function ProcessingProvider({ children }: { children: ReactNode }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState('Processing PDF…');
  const activeRequestIdRef = useRef(0);

  const startProcessing = useCallback((msg: string): number => {
    const nextId = ++activeRequestIdRef.current;
    setMessage(msg);
    setIsProcessing(true);
    return nextId;
  }, []);

  const stopProcessing = useCallback((requestId?: number) => {
    if (requestId !== undefined && requestId !== activeRequestIdRef.current) {
      // Stale completion request: do not dismiss a newer active loader
      return;
    }
    setIsProcessing(false);
  }, []);

  const runWithProcessing = useCallback(
    async <T,>(msg: string, task: () => Promise<T>): Promise<T> => {
      const reqId = startProcessing(msg);
      // Yield to the event loop so the browser/WebView paints the full-screen loader immediately
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        return await task();
      } finally {
        stopProcessing(reqId);
      }
    },
    [startProcessing, stopProcessing]
  );

  const value = useMemo<ProcessingContextType>(
    () => ({
      isProcessing,
      message,
      startProcessing,
      stopProcessing,
      runWithProcessing,
    }),
    [isProcessing, message, startProcessing, stopProcessing, runWithProcessing]
  );

  return (
    <ProcessingContext.Provider value={value}>
      {children}
    </ProcessingContext.Provider>
  );
}
