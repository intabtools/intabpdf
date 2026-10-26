// PDF Processing Service: dispatches operations to Web Worker with main-thread fallback.
import {
  compressPdf,
  imagesToPdf,
  mergePdfs,
  removePdfPages,
  rotatePdfPages,
  splitPdfPages,
} from '../index';
import type { PageRange, SplitOptions } from '../split';
import type { ImagesToPdfOptions, InputImage } from '../images-to-pdf';
import type { RotateOptions } from '../rotate';
import type { CompressOptions } from '../compress';

export type PdfOperation =
  | 'merge'
  | 'rotate'
  | 'remove-pages'
  | 'split'
  | 'images-to-pdf'
  | 'compress';

export interface OperationPayloads {
  merge: { buffers: Uint8Array[] };
  rotate: { buffer: Uint8Array; options?: RotateOptions };
  'remove-pages': { buffer: Uint8Array; pageIndices: number[] };
  split: { buffer: Uint8Array; ranges: PageRange[]; splitOptions?: SplitOptions };
  'images-to-pdf': { images: InputImage[]; options?: ImagesToPdfOptions };
  compress: { buffer: Uint8Array; options?: CompressOptions };
}

interface PendingRequest<T extends PdfOperation = PdfOperation> {
  operation: T;
  payload: OperationPayloads[T];
  resolve: (result: Uint8Array) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class PdfProcessingService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;
  private isWorkerSupported: boolean | null = null;

  /**
   * Lazily initializes the Web Worker.
   */
  private getWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.isWorkerSupported === false) return null;

    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      this.isWorkerSupported = false;
      return null;
    }

    try {
      this.worker = new Worker(new URL('./pdfWorker.ts', import.meta.url), {
        type: 'module',
      });

      this.worker.onmessage = (e: MessageEvent<{ id: string; ok: boolean; result?: Uint8Array; error?: string }>) => {
        const { id, ok, result, error } = e.data;
        const pending = this.pendingRequests.get(id);
        if (!pending) return;

        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);

        if (ok && result) {
          pending.resolve(result);
        } else {
          console.warn(
            `Worker operation "${pending.operation}" failed (${error || 'unknown error'}), falling back to main thread:`
          );
          this.executeOnMainThread(pending.operation, pending.payload).then(
            pending.resolve,
            pending.reject
          );
        }
      };

      this.worker.onerror = (err) => {
        console.warn('PDF Worker encountered an unhandled error, resetting worker:', err);
        this.isWorkerSupported = false;
        this.terminateWorker(true);
      };

      this.isWorkerSupported = true;
      return this.worker;
    } catch (err) {
      console.warn('Failed to spawn Web Worker, falling back to main-thread processing:', err);
      this.isWorkerSupported = false;
      return null;
    }
  }

  /**
   * Main-thread fallback when worker is unavailable or fails.
   */
  private async executeOnMainThread<T extends PdfOperation>(
    operation: T,
    payload: OperationPayloads[T]
  ): Promise<Uint8Array> {
    switch (operation) {
      case 'merge': {
        const p = payload as OperationPayloads['merge'];
        return await mergePdfs(p.buffers);
      }
      case 'rotate': {
        const p = payload as OperationPayloads['rotate'];
        return await rotatePdfPages(p.buffer, p.options);
      }
      case 'remove-pages': {
        const p = payload as OperationPayloads['remove-pages'];
        return await removePdfPages(p.buffer, p.pageIndices);
      }
      case 'split': {
        const p = payload as OperationPayloads['split'];
        const res = await splitPdfPages(p.buffer, p.ranges, p.splitOptions);
        return res.zipBytes;
      }
      case 'images-to-pdf': {
        const p = payload as OperationPayloads['images-to-pdf'];
        return await imagesToPdf(p.images, p.options);
      }
      case 'compress': {
        const p = payload as OperationPayloads['compress'];
        return await compressPdf(p.buffer, p.options);
      }
      default:
        throw new Error(`Unsupported operation on main thread: ${String(operation)}`);
    }
  }

  /**
   * Dispatches a PDF operation to the worker, falling back to the main thread if needed.
   */
  public async execute<T extends PdfOperation>(
    operation: T,
    payload: OperationPayloads[T],
    timeoutMs = 60000
  ): Promise<Uint8Array> {
    const worker = this.getWorker();

    if (!worker) {
      return this.executeOnMainThread(operation, payload);
    }

    const id = `pdf_op_${Date.now()}_${++this.requestIdCounter}`;

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        // Terminate runaway worker thread so subsequent jobs are not blocked
        this.terminateWorker();
        reject(new Error(`Operation "${operation}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        operation,
        payload,
        resolve,
        reject,
        timer,
      } as PendingRequest);

      // Create isolated slices for transfer to protect the caller's original buffers.
      // This guarantees the original input data remains non-detached and reusable
      // if fallback to main thread is required or if the user retries.
      const transferList: Transferable[] = [];
      let workerPayload: OperationPayloads[T];

      if ('buffer' in payload && payload.buffer instanceof Uint8Array) {
        const workerBuf = payload.buffer.slice();
        transferList.push(workerBuf.buffer);
        workerPayload = { ...payload, buffer: workerBuf };
      } else if ('buffers' in payload && Array.isArray(payload.buffers)) {
        const workerBufs = payload.buffers.map((b) => {
          if (b instanceof Uint8Array) {
            const copy = b.slice();
            transferList.push(copy.buffer);
            return copy;
          }
          return b;
        });
        workerPayload = { ...payload, buffers: workerBufs };
      } else if ('images' in payload && Array.isArray(payload.images)) {
        const workerImages = payload.images.map((img) => {
          if (img.bytes instanceof Uint8Array) {
            const copy = img.bytes.slice();
            transferList.push(copy.buffer);
            return { ...img, bytes: copy };
          }
          return img;
        });
        workerPayload = { ...payload, images: workerImages };
      } else {
        workerPayload = payload;
      }

      try {
        worker.postMessage({ id, operation, payload: workerPayload }, transferList);
      } catch (postErr) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        console.warn('Failed to postMessage to worker, executing on main thread with original buffers:', postErr);
        // Safely execute on main thread using the untouched original payload
        this.executeOnMainThread(operation, payload).then(resolve, reject);
      }
    });
  }

  /**
   * Clean up worker resources.
   */
  public terminateWorker(fallbackToMain = false): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    const currentPending = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();

    for (const req of currentPending) {
      clearTimeout(req.timer);
      if (fallbackToMain) {
        this.executeOnMainThread(req.operation, req.payload).then(req.resolve, req.reject);
      } else {
        req.reject(new Error('PDF Worker was terminated.'));
      }
    }
  }
}

export const pdfProcessingService = new PdfProcessingService();
