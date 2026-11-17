// Reusable sequential batch-processing engine for multi-file PDF operations.
import { createZip } from '../core';
import type { ZipEntry } from '../core';
import { getCleanBaseName } from './filename';
import type { StagedFile } from './types';

export interface BatchItemOutput {
  name: string;
  bytes: Uint8Array;
}

export interface BatchStats {
  total: number;
  successCount: number;
  failureCount: number;
  failures: { fileName: string; reason: string }[];
}

export interface BatchOperationOptions {
  actionVerb: string;
  stagedFiles: StagedFile[];
  processFile: (
    file: StagedFile,
    index: number
  ) => Promise<BatchItemOutput | BatchItemOutput[]>;
  updateMessage?: (message: string) => void;
  onExtraStateChange?: (key: string, value: unknown) => void;
  outputZipBaseName?: string;
  signal?: AbortSignal;
}

/**
 * Executes an operation sequentially across multiple staged files,
 * isolating per-file failures, supporting cooperative cancellation,
 * and packaging successful outputs into a ZIP archive.
 */
export async function executeBatchOperation({
  actionVerb,
  stagedFiles,
  processFile,
  updateMessage,
  onExtraStateChange,
  signal,
}: BatchOperationOptions): Promise<Uint8Array> {
  if (stagedFiles.length === 0) {
    throw new Error('No files staged for processing.');
  }

  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  const zipEntries: ZipEntry[] = [];
  const usedNames = new Set<string>();
  const failures: { fileName: string; reason: string }[] = [];
  let successfulOriginalBytes = 0;

  for (let i = 0; i < stagedFiles.length; i++) {
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    const curFile = stagedFiles[i];
    updateMessage?.(`${actionVerb}: processing file ${i + 1} of ${stagedFiles.length}…`);

    // Micro-pause to yield to event loop so UI loader updates, paints, and receives cancel click
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    try {
      const result = await processFile(curFile, i);

      // Check if cancelled immediately after processFile finishes
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const items = Array.isArray(result) ? result : [result];

      for (const item of items) {
        let entryName = item.name;
        const dotIdx = entryName.lastIndexOf('.');
        const ext = dotIdx !== -1 ? entryName.slice(dotIdx) : '';
        const rawBase = dotIdx !== -1 ? entryName.slice(0, dotIdx) : entryName;

        let counter = 2;
        while (usedNames.has(entryName.toLowerCase())) {
          entryName = `${rawBase}-${counter}${ext}`;
          counter++;
        }
        usedNames.add(entryName.toLowerCase());

        zipEntries.push({
          name: entryName,
          bytes: item.bytes,
        });
      }

      successfulOriginalBytes += curFile.size;
    } catch (err) {
      if (
        signal?.aborted ||
        (err instanceof Error &&
          (err.name === 'AbortError' ||
            err.name === 'RenderingCancelledException' ||
            err.message.toLowerCase().includes('cancel')))
      ) {
        throw err;
      }
      const reason =
        err instanceof Error && err.message
          ? err.message
          : 'Processing failed';
      failures.push({
        fileName: curFile.name,
        reason,
      });
    }
  }

  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  if (zipEntries.length === 0) {
    const sampleReason = failures[0]?.reason ? `: ${failures[0].reason}` : '';
    throw new Error(
      `All ${stagedFiles.length} files failed to process${sampleReason}`
    );
  }

  const batchStats: BatchStats = {
    total: stagedFiles.length,
    successCount: stagedFiles.length - failures.length,
    failureCount: failures.length,
    failures,
  };

  onExtraStateChange?.('batchStats', batchStats);
  onExtraStateChange?.('successfulOriginalBytes', successfulOriginalBytes);

  return createZip(zipEntries);
}

/**
 * Generates a deduplicated entry filename for a staged document.
 */
export function getCollisionSafeName(
  fileName: string,
  prefix: string,
  ext: string,
  usedNames: Set<string>
): string {
  const clean = getCleanBaseName(fileName) || 'document';
  let candidate = prefix ? `${prefix}-${clean}${ext}` : `${clean}${ext}`;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = prefix ? `${prefix}-${clean}-${counter}${ext}` : `${clean}-${counter}${ext}`;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}
