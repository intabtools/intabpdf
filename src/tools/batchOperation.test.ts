import { describe, expect, it, vi } from 'vitest';
import { executeBatchOperation } from './batchOperation';
import { executeBatchCompression } from './modules/compress/batchCompress';
import type { StagedFile } from './types';
import { pdfProcessingService } from '../core';

function createDummyStagedFile(id: string, name: string): StagedFile {
  return {
    id,
    name,
    size: 100,
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
  };
}

describe('Batch Operations Cancellation & Retry Safety Tests', () => {
  it('cancellation during a batch stops subsequent files immediately', async () => {
    const stagedFiles: StagedFile[] = [
      createDummyStagedFile('1', 'file1.pdf'),
      createDummyStagedFile('2', 'file2.pdf'),
      createDummyStagedFile('3', 'file3.pdf'),
      createDummyStagedFile('4', 'file4.pdf'),
    ];

    const abortCtrl = new AbortController();
    const processedIndices: number[] = [];

    const batchPromise = executeBatchOperation({
      actionVerb: 'Rotating',
      stagedFiles,
      signal: abortCtrl.signal,
      processFile: async (_file, index) => {
        processedIndices.push(index);
        if (index === 1) {
          // Abort during processing of the second file
          abortCtrl.abort();
        }
        return {
          name: `out-${index}.pdf`,
          bytes: new Uint8Array([index]),
        };
      },
    });

    await expect(batchPromise).rejects.toThrow(/cancelled|aborted/i);

    // Files 2 and 3 (0-based indices 2 and 3) must never have been processed
    expect(processedIndices).toEqual([0, 1]);
    expect(processedIndices).not.toContain(2);
    expect(processedIndices).not.toContain(3);
  });

  it('no partial ZIP or output bytes are returned when batch is cancelled', async () => {
    const stagedFiles: StagedFile[] = [
      createDummyStagedFile('1', 'a.pdf'),
      createDummyStagedFile('2', 'b.pdf'),
    ];

    const abortCtrl = new AbortController();
    let resolvedResult: Uint8Array | null = null;
    let caughtError: unknown = null;

    try {
      resolvedResult = await executeBatchOperation({
        actionVerb: 'Processing',
        stagedFiles,
        signal: abortCtrl.signal,
        processFile: async (_file, index) => {
          if (index === 0) {
            abortCtrl.abort();
          }
          return { name: 'res.pdf', bytes: new Uint8Array([1]) };
        },
      });
    } catch (err) {
      caughtError = err;
    }

    // Result must be strictly null (not a partial ZIP)
    expect(resolvedResult).toBeNull();
    expect(caughtError).toBeInstanceOf(DOMException);
    expect((caughtError as DOMException).name).toBe('AbortError');
  });

  it('already staged input files remain untouched and available for immediate clean retry', async () => {
    const originalBytes1 = new Uint8Array([10, 20, 30]);
    const originalBytes2 = new Uint8Array([40, 50, 60]);

    const stagedFiles: StagedFile[] = [
      { id: 'f1', name: 'doc1.pdf', size: 3, bytes: originalBytes1 },
      { id: 'f2', name: 'doc2.pdf', size: 3, bytes: originalBytes2 },
    ];

    const abortCtrl = new AbortController();

    // Run batch attempt 1 and cancel it on file 1
    const run1 = executeBatchOperation({
      actionVerb: 'Processing',
      stagedFiles,
      signal: abortCtrl.signal,
      processFile: async () => {
        abortCtrl.abort();
        throw new DOMException('Operation cancelled', 'AbortError');
      },
    });

    await expect(run1).rejects.toThrow(/cancelled|aborted/i);

    // Invariant: stagedFiles array and underlying buffers remain non-detached and un-mutated
    expect(stagedFiles.length).toBe(2);
    expect(stagedFiles[0].bytes).toBe(originalBytes1);
    expect(stagedFiles[0].bytes.byteLength).toBe(3);
    expect(stagedFiles[1].bytes).toBe(originalBytes2);
    expect(stagedFiles[1].bytes.byteLength).toBe(3);

    // Retry batch attempt 2 immediately with fresh non-aborted signal
    const retryCtrl = new AbortController();
    const retryProcessed: string[] = [];

    const retryResult = await executeBatchOperation({
      actionVerb: 'Processing',
      stagedFiles,
      signal: retryCtrl.signal,
      processFile: async (file) => {
        retryProcessed.push(file.name);
        return {
          name: `processed-${file.name}`,
          bytes: new Uint8Array(file.bytes),
        };
      },
    });

    // All files processed cleanly on retry
    expect(retryProcessed).toEqual(['doc1.pdf', 'doc2.pdf']);
    expect(retryResult).toBeInstanceOf(Uint8Array);
    expect(retryResult.byteLength).toBeGreaterThan(0);
  });

  it('executeBatchCompression halts subsequent files and preserves staged files on cancellation', async () => {
    const stagedFiles: StagedFile[] = [
      createDummyStagedFile('c1', 'report1.pdf'),
      createDummyStagedFile('c2', 'report2.pdf'),
      createDummyStagedFile('c3', 'report3.pdf'),
    ];

    const abortCtrl = new AbortController();
    const compressedFiles: string[] = [];

    // Spy on pdfProcessingService.execute to observe sequential file compression
    vi.spyOn(pdfProcessingService, 'execute').mockImplementation(async (op, _payload, options) => {
      if (op === 'compress') {
        const signal = typeof options === 'object' ? options.signal : undefined;
        compressedFiles.push(`file-${compressedFiles.length + 1}`);

        if (compressedFiles.length === 1) {
          abortCtrl.abort();
        }

        if (signal?.aborted) {
          throw new DOMException('Operation was aborted.', 'AbortError');
        }

        return new Uint8Array([1, 2]);
      }
      return new Uint8Array([]);
    });

    const batchCompPromise = executeBatchCompression(
      stagedFiles,
      {
        mode: 'recommended',
      },
      {
        signal: abortCtrl.signal,
      }
    );

    await expect(batchCompPromise).rejects.toThrow(/cancelled|aborted/i);

    // Only file 1 was attempted; files 2 and 3 were never dispatched
    expect(compressedFiles.length).toBe(1);
    expect(stagedFiles.length).toBe(3);
  });
});
