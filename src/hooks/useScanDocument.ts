import { useCallback, useContext, useRef, useState } from 'react';
import { getPlatformType, type OpenedFile } from '../platform';
import { scanDocumentToOpenedFile } from '../platform/scanner';
import { ViewerContext } from '../viewer/viewerContextDef';
import { useToast } from './useToast';

/**
 * Explicit platform guard ensuring scanner UI and native bridge calls only exist on Android.
 */
export function isAndroidScannerSupported(platform = getPlatformType()): boolean {
  return platform === 'android';
}

export interface ScanToViewerDeps {
  loadFile: (file: OpenedFile) => void;
  setIsLoading: (loading: boolean) => void;
  showToast: (message: string) => void;
  scanFn?: typeof scanDocumentToOpenedFile;
  platform?: ReturnType<typeof getPlatformType>;
}

export async function runScanToViewerHandoff(deps: ScanToViewerDeps): Promise<'completed' | 'cancelled' | 'unsupported' | 'error'> {
  const platform = deps.platform ?? getPlatformType();
  if (!isAndroidScannerSupported(platform)) {
    return 'unsupported';
  }
  const scanFn = deps.scanFn ?? scanDocumentToOpenedFile;
  try {
    const outcome = await scanFn();
    if (outcome.status === 'completed') {
      deps.loadFile(outcome.file);
      return 'completed';
    }
    return 'cancelled';
  } catch (err) {
    deps.setIsLoading(false);
    const message =
      err instanceof Error && err.message.trim()
        ? err.message
        : 'Could not scan document. Please try again.';
    deps.showToast(message);
    return 'error';
  }
}

export interface ScanDocumentLauncherState {
  isScanning: boolean;
  launchScanner: () => Promise<void>;
}

/**
 * Launches the native Android document scanner, opens the completed PDF directly in Viewer,
 * and surfaces errors safely without exposing any UI on Web or Desktop.
 */
export function useScanDocument(): ScanDocumentLauncherState {
  const viewer = useContext(ViewerContext);
  const { showToast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const inFlightRef = useRef(false);

  const launchScanner = useCallback(async () => {
    if (!isAndroidScannerSupported() || !viewer) {
      return;
    }
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsScanning(true);
    try {
      await runScanToViewerHandoff({
        loadFile: viewer.loadFile,
        setIsLoading: viewer.setIsLoading,
        showToast,
      });
    } finally {
      inFlightRef.current = false;
      setIsScanning(false);
    }
  }, [viewer, showToast]);

  return { isScanning, launchScanner };
}
