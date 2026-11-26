import { useCallback, useContext, useRef, useState } from 'react';
import { getPlatformType, platform as platformApi, type OpenedFile, type SaveFileResult } from '../platform';
import { scanDocumentToOpenedFile } from '../platform/scanner';
import { sharePdfDocument, type ShareOutcome } from '../platform/share';
import { ViewerContext } from '../viewer/viewerContextDef';
import { useSaveRecovery } from './useSaveRecovery';
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
  showToast: (message: string, durationMs?: number) => void;
  saveFile?: (bytes: Uint8Array, fileName: string, mimeType?: string) => Promise<SaveFileResult | void>;
  sharePdf?: (params: { fileName?: string; bytes?: Uint8Array | null }) => Promise<ShareOutcome>;
  attachRetrySave?: (retryFn: () => Promise<void>) => void;
  scanFn?: typeof scanDocumentToOpenedFile;
  platform?: ReturnType<typeof getPlatformType>;
}

async function handleSaveScannedPdf(
  file: OpenedFile,
  deps: Pick<ScanToViewerDeps, 'saveFile' | 'showToast' | 'attachRetrySave'>,
): Promise<'saved' | 'cancelled' | 'error'> {
  const saveFn = deps.saveFile ?? platformApi.saveFile;
  if (!saveFn) {
    deps.showToast('Saving files is unavailable on this device.');
    return 'error';
  }

  try {
    const res = await saveFn(file.bytes, file.name, 'application/pdf');
    if (res && res.saved === false) {
      if (res.outcome === 'cancelled') {
        deps.showToast('Save cancelled');
        return 'cancelled';
      }
      if (res.outcome === 'failed_recovery_available' && res.recovery) {
        deps.attachRetrySave?.(async () => {
          await handleSaveScannedPdf(file, deps);
        });
        deps.showToast(res.message || 'Could not complete save. Recovery backup preserved.', 4000);
        return 'error';
      }
      deps.showToast(
        res.message || 'Could not save PDF; any existing file remains intact.',
        4000,
      );
      return 'error';
    }

    const savedName = (res && res.fileName) || file.name;
    deps.showToast(
      res && 'displayPath' in res && res.displayPath
        ? `Saved ${savedName} to ${res.displayPath}`
        : `Saved ${savedName}`,
    );
    return 'saved';
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim()
        ? err.message
        : 'Could not save scanned PDF.';
    deps.showToast(message);
    return 'error';
  }
}

export async function runScanToViewerHandoff(
  deps: ScanToViewerDeps,
): Promise<'completed' | 'saved' | 'shared' | 'cancelled' | 'unsupported' | 'error'> {
  const platform = deps.platform ?? getPlatformType();
  if (!isAndroidScannerSupported(platform)) {
    return 'unsupported';
  }
  const scanFn = deps.scanFn ?? scanDocumentToOpenedFile;
  try {
    const outcome = await scanFn();
    if (outcome.status === 'cancelled') {
      return 'cancelled';
    }

    const action = outcome.action ?? 'view';
    if (action === 'save') {
      return await handleSaveScannedPdf(outcome.file, deps);
    }

    if (action === 'share') {
      const shareFn = deps.sharePdf ?? sharePdfDocument;
      const shareOutcome = await shareFn({
        fileName: outcome.file.name,
        bytes: outcome.file.bytes,
      });
      if (shareOutcome.status === 'canceled') {
        return 'cancelled';
      }
      if (shareOutcome.status !== 'shared') {
        deps.showToast(shareOutcome.message);
        return shareOutcome.ok ? 'shared' : 'error';
      }
      return 'shared';
    }

    deps.loadFile(outcome.file);
    return 'completed';
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
 * Launches the native Android document scanner, routes Save PDF via SAF, Open in Viewer via
 * ViewerContext, or Share via native sharing, without exposing any UI on Web or Desktop.
 */
export function useScanDocument(): ScanDocumentLauncherState {
  const viewer = useContext(ViewerContext);
  const saveRecovery = useSaveRecovery();
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
        saveFile: platformApi.saveFile,
        sharePdf: sharePdfDocument,
        attachRetrySave: saveRecovery?.attachRetrySave,
      });
    } finally {
      inFlightRef.current = false;
      setIsScanning(false);
    }
  }, [viewer, saveRecovery, showToast]);

  return { isScanning, launchScanner };
}
