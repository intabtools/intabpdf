import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPlatformType, platform, type OpenedFile } from '../platform';
import { ViewerContext } from './viewerContextDef';

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [currentFile, setCurrentFile] = useState<OpenedFile | null>(null);
  const [initialHasPending] = useState(() => platform.hasPendingFile?.() ?? false);
  const [isLoading, setIsLoading] = useState(initialHasPending);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);

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
    }),
    [currentFile, openPdfPicker, loadFile, isLoading]
  );

  return (
    <ViewerContext.Provider value={value}>
      {children}
    </ViewerContext.Provider>
  );
}
