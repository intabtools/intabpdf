// Sequential batch PDF compression engine with individual failure isolation and dynamic progress reporting.
import { createZip, pdfProcessingService } from '../../../core';
import type { CompressionPreset, ZipEntry } from '../../../core';
import { getCleanBaseName } from '../../filename';
import type { StagedFile } from '../../types';
import type { CompressionMode } from './compressConfig';

export interface BatchCompressionOptions {
  mode: CompressionMode;
  targetBytes?: number | null;
  corePreset?: CompressionPreset;
  downsampleImages?: boolean;
  stripMetadata?: boolean;
}

export interface BatchCompressionCallbacks {
  updateMessage?: (message: string) => void;
  onExtraStateChange?: (key: string, value: unknown) => void;
}

export async function executeBatchCompression(
  stagedFiles: StagedFile[],
  options: BatchCompressionOptions,
  callbacks?: BatchCompressionCallbacks
): Promise<Uint8Array> {
  const zipEntries: ZipEntry[] = [];
  const usedNames = new Set<string>();
  const failures: { fileName: string; reason: string }[] = [];
  let successfulOriginalBytes = 0;

  for (let i = 0; i < stagedFiles.length; i++) {
    const curFile = stagedFiles[i];
    callbacks?.updateMessage?.(
      `Compressing file ${i + 1} of ${stagedFiles.length}…`
    );
    // Micro-pause to allow UI loader re-render and paint
    await new Promise((resolve) => setTimeout(resolve, 10));

    try {
      const compressedBytes = await pdfProcessingService.execute('compress', {
        buffer: curFile.bytes,
        options: {
          targetBytes: options.mode === 'target' ? (options.targetBytes ?? undefined) : undefined,
          preset: options.corePreset,
          downsampleImages: options.downsampleImages ?? true,
          stripMetadata: options.stripMetadata ?? true,
        },
      });

      const rawBase = getCleanBaseName(curFile.name) || `document-${i + 1}`;
      let entryName = `compressed-${rawBase}.pdf`;
      let counter = 2;
      while (usedNames.has(entryName.toLowerCase())) {
        entryName = `compressed-${rawBase}-${counter}.pdf`;
        counter++;
      }
      usedNames.add(entryName.toLowerCase());

      zipEntries.push({
        name: entryName,
        bytes: compressedBytes,
      });
      successfulOriginalBytes += curFile.size;
    } catch (err) {
      const reason =
        err instanceof Error && err.message
          ? err.message
          : 'Corrupt or unsupported PDF structure';
      failures.push({
        fileName: curFile.name,
        reason,
      });
    }
  }

  if (zipEntries.length === 0) {
    const sampleReason = failures[0]?.reason ? `: ${failures[0].reason}` : '';
    throw new Error(
      `All ${stagedFiles.length} files failed to compress${sampleReason}`
    );
  }

  callbacks?.onExtraStateChange?.('batchStats', {
    total: stagedFiles.length,
    successCount: zipEntries.length,
    failureCount: failures.length,
    failures,
  });
  callbacks?.onExtraStateChange?.('successfulOriginalBytes', successfulOriginalBytes);

  return createZip(zipEntries);
}
