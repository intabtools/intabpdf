// Capacitor bridge and lifecycle helpers for the Android-only native document scanner.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getPlatformType } from './index';
import type { OpenedFile } from './types';

export type ScanFilter = 'auto' | 'original' | 'color' | 'grayscale' | 'bw';
export type ScanQuality = 'low' | 'balanced' | 'high';
export type ScanPostExportAction = 'save' | 'share';

export interface StartScanOptions {
  defaultFilter?: ScanFilter;
  quality?: ScanQuality;
  autoCaptureDefault?: boolean;
  suggestedFileName?: string;
}

export interface ScannerAvailability {
  available: boolean;
  hasCameraHardware: boolean;
  hasCameraPermission: boolean;
}

export interface ScanResult {
  status: 'completed' | 'cancelled';
  action?: ScanPostExportAction;
  pdfFileUrl?: string;
  fileName?: string;
  pageCount?: number;
  sizeBytes?: number;
}

export interface DocumentScannerPlugin {
  isAvailable(): Promise<ScannerAvailability>;
  startScan(options?: StartScanOptions): Promise<ScanResult>;
  cleanupOutput(options: { pdfFileUrl: string }): Promise<{ deleted?: boolean }>;
}

const DocumentScanner = registerPlugin<DocumentScannerPlugin>('DocumentScanner');

function isAndroidRuntime(): boolean {
  return getPlatformType() === 'android' && Capacitor.isNativePlatform();
}

export async function isDocumentScannerAvailable(): Promise<ScannerAvailability> {
  if (!isAndroidRuntime()) {
    return {
      available: false,
      hasCameraHardware: false,
      hasCameraPermission: false,
    };
  }
  try {
    return await DocumentScanner.isAvailable();
  } catch {
    return {
      available: false,
      hasCameraHardware: false,
      hasCameraPermission: false,
    };
  }
}

export async function cleanupScannerOutput(pdfFileUrl?: string): Promise<void> {
  if (!pdfFileUrl || !isAndroidRuntime()) return;
  try {
    await DocumentScanner.cleanupOutput({ pdfFileUrl });
  } catch {
    // Best-effort cleanup; Android session pruning handles orphaned cache files after 24h
  }
}

/**
 * Starts the native Android scanner and resolves the generated PDF bytes into an OpenedFile,
 * always cleaning up the temporary native scanner output file afterwards.
 */
export async function scanDocumentToOpenedFile(
  options?: StartScanOptions,
): Promise<
  | { status: 'completed'; action: ScanPostExportAction; file: OpenedFile; pageCount: number }
  | { status: 'cancelled' }
> {
  if (!isAndroidRuntime()) {
    throw new Error('Document scanner is only available on Android.');
  }

  const result = await DocumentScanner.startScan(options);
  if (result.status === 'cancelled') {
    return { status: 'cancelled' };
  }

  if (!result.pdfFileUrl) {
    throw new Error('Scanner finished without returning a PDF file.');
  }

  try {
    const webUrl = Capacitor.convertFileSrc(result.pdfFileUrl);
    const response = await fetch(webUrl);
    if (!response.ok) {
      throw new Error(`Could not read scanned PDF (HTTP ${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      throw new Error('Scanned output was not a valid PDF document.');
    }

    const rawName = result.fileName?.trim() || 'scan.pdf';
    const fileName = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
    const action: ScanPostExportAction =
      result.action === 'share' ? 'share' : 'save';
    return {
      status: 'completed',
      action,
      file: { name: fileName, bytes },
      pageCount: result.pageCount && result.pageCount > 0 ? result.pageCount : 1,
    };
  } finally {
    await cleanupScannerOutput(result.pdfFileUrl);
  }
}
