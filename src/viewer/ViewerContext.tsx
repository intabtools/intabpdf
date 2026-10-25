import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { platform, type OpenedFile } from '../platform';
import { ViewerContext } from './viewerContextDef';

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [currentFile, setCurrentFile] = useState<OpenedFile | null>(null);
  const navigate = useNavigate();

  // Listen to platform file open events (e.g. Electron file associations, Android intent, drag onto dock)
  useEffect(() => {
    return platform.onFileOpened((file) => {
      setCurrentFile(file);
      navigate('/viewer');
    });
  }, [navigate]);

  const openPdfPicker = async (): Promise<OpenedFile | null> => {
    try {
      const file = await platform.pickPdfFile();
      if (file) {
        setCurrentFile(file);
      }
      return file;
    } catch (err) {
      console.error('Failed to pick PDF file:', err);
      return null;
    }
  };

  const loadFile = (file: OpenedFile) => {
    setCurrentFile(file);
  };

  return (
    <ViewerContext.Provider
      value={{
        currentFile,
        setCurrentFile,
        openPdfPicker,
        loadFile,
      }}
    >
      {children}
    </ViewerContext.Provider>
  );
}
