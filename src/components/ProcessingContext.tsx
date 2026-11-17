// Provider managing global file-processing loading state, accurate messages, and stale request protection.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ProcessingContext, type ProcessingContextType } from './processingContextDef';

export function ProcessingProvider({ children }: { children: ReactNode }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [message, setMessage] = useState('Processing PDF…');
  const [cancelHandler, setCancelHandlerState] = useState<(() => void) | null>(null);
  const activeRequestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const isBusyRef = useRef(false);

  const cancelProcessing = useCallback(() => {
    if (!isBusyRef.current || !activeControllerRef.current) return;
    setIsCancelling(true);
    activeControllerRef.current.abort();
  }, []);

  const setCancelHandler = useCallback((handler: (() => void) | null) => {
    setCancelHandlerState(() => handler);
  }, []);

  const startProcessing = useCallback((msg: string): number => {
    const nextId = ++activeRequestIdRef.current;
    setMessage(msg);
    setIsProcessing(true);
    setIsCancelling(false);
    return nextId;
  }, []);

  const stopProcessing = useCallback((requestId?: number) => {
    if (requestId !== undefined && requestId !== activeRequestIdRef.current) {
      // Stale completion request: do not dismiss a newer active loader
      return;
    }
    isBusyRef.current = false;
    setIsProcessing(false);
    setIsCancelling(false);
    setCancelHandlerState(null);
    if (activeControllerRef.current) {
      activeControllerRef.current = null;
    }
  }, []);

  const updateMessage = useCallback((msg: string) => {
    setMessage(msg);
  }, []);

  const runWithProcessing = useCallback(
    async <T,>(msg: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      // Policy B Concurrency Guard: reject concurrent invocations to protect memory and state
      if (isBusyRef.current) {
        throw new Error('Another operation is already in progress. Please wait for it to complete or cancel it.');
      }

      // Safely retire previous controller if lingering
      if (activeControllerRef.current) {
        activeControllerRef.current.abort();
        activeControllerRef.current = null;
      }

      const reqId = ++activeRequestIdRef.current;
      const controller = new AbortController();
      activeControllerRef.current = controller;
      isBusyRef.current = true;

      setMessage(msg);
      setIsProcessing(true);
      setIsCancelling(false);

      setCancelHandlerState(() => () => {
        if (activeRequestIdRef.current === reqId) {
          setIsCancelling(true);
          controller.abort();
        }
      });

      // Yield to the event loop so the browser/WebView paints the full-screen loader immediately
      await new Promise((resolve) => setTimeout(resolve, 0));

      try {
        return await task(controller.signal);
      } finally {
        if (activeRequestIdRef.current === reqId) {
          isBusyRef.current = false;
          setIsProcessing(false);
          setIsCancelling(false);
          setCancelHandlerState(null);
          activeControllerRef.current = null;
        }
      }
    },
    []
  );

  const value = useMemo<ProcessingContextType>(
    () => ({
      isProcessing,
      isCancelling,
      message,
      startProcessing,
      stopProcessing,
      updateMessage,
      runWithProcessing,
      cancelProcessing,
      cancelHandler,
      setCancelHandler,
    }),
    [
      isProcessing,
      isCancelling,
      message,
      startProcessing,
      stopProcessing,
      updateMessage,
      runWithProcessing,
      cancelProcessing,
      cancelHandler,
      setCancelHandler,
    ]
  );

  return (
    <ProcessingContext.Provider value={value}>
      {children}
    </ProcessingContext.Provider>
  );
}
