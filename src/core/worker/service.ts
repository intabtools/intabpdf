// PDF Processing Service: dispatches operations to Web Worker with main-thread fallback,
// FIFO serialized queue, dedicated worker isolation, and universal cancellation support.
import type { PageRange, SplitOptions } from '../split';
import type { ImagesToPdfOptions, InputImage } from '../images-to-pdf';
import type { RotateOptions } from '../rotate';
import type { CompressOptions } from '../compress';
import type { MergeOptions } from '../merge';

export type PdfOperation =
  | 'merge'
  | 'rotate'
  | 'remove-pages'
  | 'split'
  | 'images-to-pdf'
  | 'compress';

export interface OperationPayloads {
  merge: { buffers: Uint8Array[]; options?: MergeOptions };
  rotate: { buffer: Uint8Array; options?: RotateOptions };
  'remove-pages': { buffer: Uint8Array; pageIndices: number[] };
  split: { buffer: Uint8Array; ranges: PageRange[]; splitOptions?: SplitOptions };
  'images-to-pdf': { images: InputImage[]; options?: ImagesToPdfOptions };
  compress: { buffer: Uint8Array; options?: CompressOptions };
}

export interface ExecuteOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

type TerminalReason = 'caller-aborted' | 'timed-out' | 'errored' | 'completed';

interface InternalRequest<T extends PdfOperation = PdfOperation> {
  id: string;
  operation: T;
  payload: OperationPayloads[T];
  timeoutMs: number;
  callerSignal?: AbortSignal;
  internalController: AbortController;
  state: 'queued' | 'active' | 'settled';
  terminalReason: TerminalReason | null;
  settled: boolean;
  resolve: (result: Uint8Array) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  cleanupCallerAbortListener: (() => void) | null;
  dispatchedWorker: Worker | null;
}

class PdfProcessingService {
  private queue: InternalRequest[] = [];
  private activeRequest: InternalRequest | null = null;
  private requestIdCounter = 0;
  private isWorkerSupported: boolean | null = null;
  private consecutiveSpawnFailures = 0;

  /**
   * Operation-aware default timeouts.
   */
  public getDefaultTimeout(op: PdfOperation): number {
    switch (op) {
      case 'rotate':
      case 'remove-pages':
        return 60_000; // 60 seconds
      case 'merge':
      case 'split':
        return 120_000; // 120 seconds (2 minutes)
      case 'compress':
      case 'images-to-pdf':
        return 180_000; // 180 seconds (3 minutes)
      default:
        return 60_000;
    }
  }

  /**
   * Public entrypoint: queues request and returns Promise.
   * Supports both execute(op, payload, options) and legacy execute(op, payload, timeoutMs).
   */
  public execute<T extends PdfOperation>(
    operation: T,
    payload: OperationPayloads[T],
    optionsOrTimeout?: ExecuteOptions | number
  ): Promise<Uint8Array> {
    let timeoutMs: number | undefined;
    let callerSignal: AbortSignal | undefined;

    if (typeof optionsOrTimeout === 'number') {
      timeoutMs = optionsOrTimeout;
    } else if (optionsOrTimeout && typeof optionsOrTimeout === 'object') {
      timeoutMs = optionsOrTimeout.timeoutMs;
      callerSignal = optionsOrTimeout.signal;
    }

    if (callerSignal?.aborted) {
      return Promise.reject(
        callerSignal.reason || new DOMException('Operation was aborted.', 'AbortError')
      );
    }

    const id = `pdf_op_${Date.now()}_${++this.requestIdCounter}`;
    const effectiveTimeoutMs = timeoutMs ?? this.getDefaultTimeout(operation);
    const internalController = new AbortController();

    return new Promise<Uint8Array>((resolve, reject) => {
      const req: InternalRequest<T> = {
        id,
        operation,
        payload,
        timeoutMs: effectiveTimeoutMs,
        callerSignal,
        internalController,
        state: 'queued',
        terminalReason: null,
        settled: false,
        resolve,
        reject,
        timer: null,
        cleanupCallerAbortListener: null,
        dispatchedWorker: null,
      };

      if (callerSignal) {
        const onCallerAbortWhileQueued = () => {
          if (req.state === 'queued') {
            this.settleQueuedRequest(
              req as InternalRequest,
              'reject',
              callerSignal?.reason || new DOMException('Operation was aborted.', 'AbortError')
            );
          }
        };
        callerSignal.addEventListener('abort', onCallerAbortWhileQueued, { once: true });
        req.cleanupCallerAbortListener = () => {
          callerSignal?.removeEventListener('abort', onCallerAbortWhileQueued);
        };
      }

      this.queue.push(req as InternalRequest);
      this.processQueue();
    });
  }

  /**
   * Settles a queued request. Encapsulates atomic removal from queue.
   * INVARIANT: Never touches activeRequest; never advances queue.
   */
  private settleQueuedRequest(
    req: InternalRequest,
    action: 'resolve' | 'reject',
    value: Uint8Array | Error
  ): void {
    if (req.state !== 'queued' || this.activeRequest === req || req.settled) {
      return;
    }

    const index = this.queue.indexOf(req);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }

    req.settled = true;
    req.state = 'settled';

    if (req.cleanupCallerAbortListener) {
      req.cleanupCallerAbortListener();
      req.cleanupCallerAbortListener = null;
    }

    if (action === 'resolve') {
      req.resolve(value as Uint8Array);
    } else {
      req.reject(value as Error);
    }
  }

  /**
   * Advances FIFO queue.
   */
  private processQueue(): void {
    if (this.activeRequest !== null || this.queue.length === 0) {
      return;
    }

    const req = this.queue.shift()!;
    req.state = 'active';
    this.activeRequest = req;

    // Remove queued-stage abort listener
    if (req.cleanupCallerAbortListener) {
      req.cleanupCallerAbortListener();
      req.cleanupCallerAbortListener = null;
    }

    // Check if caller aborted during queue transition
    if (req.callerSignal?.aborted) {
      this.settleActiveRequest(
        req,
        'reject',
        req.callerSignal.reason || new DOMException('Operation was aborted.', 'AbortError')
      );
      return;
    }

    // Wire active abort listener
    if (req.callerSignal) {
      const onActiveAbort = () => this.handleActiveCancellation(req);
      req.callerSignal.addEventListener('abort', onActiveAbort, { once: true });
      req.cleanupCallerAbortListener = () => {
        req.callerSignal?.removeEventListener('abort', onActiveAbort);
      };
    }

    // Start request timer
    req.timer = setTimeout(() => this.handleActiveTimeout(req), req.timeoutMs);

    // Route to Worker or Main Thread
    if (this.isWorkerSupported !== false && typeof Worker !== 'undefined') {
      this.dispatchToWorker(req);
    } else {
      this.dispatchToMainThread(req);
    }
  }

  /**
   * First-terminal-reason-wins arbiter.
   */
  private lockTerminalReason(req: InternalRequest, reason: TerminalReason): boolean {
    if (req.terminalReason !== null) {
      return false;
    }
    req.terminalReason = reason;
    return true;
  }

  /**
   * Active request cancellation handler.
   */
  private handleActiveCancellation(req: InternalRequest): void {
    if (this.activeRequest !== req || req.settled) return;
    if (!this.lockTerminalReason(req, 'caller-aborted')) return;

    const abortError =
      req.callerSignal?.reason || new DOMException('Operation was aborted.', 'AbortError');
    req.internalController.abort(abortError);

    if (req.dispatchedWorker) {
      // Worker: terminate immediately
      this.settleActiveRequest(req, 'reject', abortError);
    }
    // Main thread: cooperative, keep activeRequest until fallback promise settles
  }

  /**
   * Active request timeout handler.
   */
  private handleActiveTimeout(req: InternalRequest): void {
    if (this.activeRequest !== req || req.settled) return;
    if (!this.lockTerminalReason(req, 'timed-out')) return;

    const timeoutError = new DOMException(
      `Operation "${req.operation}" timed out after ${req.timeoutMs}ms.`,
      'TimeoutError'
    );
    req.internalController.abort(timeoutError);

    if (req.dispatchedWorker) {
      // Worker: terminate immediately
      this.settleActiveRequest(req, 'reject', timeoutError);
    }
    // Main thread: cooperative, keep activeRequest until fallback promise settles
  }

  /**
   * Dispatches request to a dedicated per-request worker with full response validation.
   */
  private dispatchToWorker(req: InternalRequest): void {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./pdfWorker.ts', import.meta.url), { type: 'module' });
    } catch (spawnErr) {
      this.consecutiveSpawnFailures++;
      if (this.consecutiveSpawnFailures >= 3) {
        this.isWorkerSupported = false;
      }
      console.warn('Worker spawn failed; executing on main thread:', spawnErr);
      this.dispatchToMainThread(req);
      return;
    }

    req.dispatchedWorker = worker;

    worker.onmessage = (
      e: MessageEvent<{ id: string; ok: boolean; result?: Uint8Array; error?: string }>
    ) => {
      // 1. Validate active request identity, worker instance, and settlement
      if (this.activeRequest !== req || req.dispatchedWorker !== worker || req.settled) {
        return;
      }

      // 2. Validate payload structure and exact ID match
      if (!e.data || typeof e.data !== 'object' || e.data.id !== req.id) {
        return;
      }

      const { ok, result, error } = e.data;

      if (ok && result) {
        if (this.lockTerminalReason(req, 'completed')) {
          this.consecutiveSpawnFailures = 0;
          this.settleActiveRequest(req, 'resolve', result);
        }
      } else {
        // Task error: worker executed. NEVER fall back to main thread.
        if (this.lockTerminalReason(req, 'errored')) {
          const taskErr = new Error(error || `Worker operation "${req.operation}" failed.`);
          this.settleActiveRequest(req, 'reject', taskErr);
        }
      }
    };

    worker.onmessageerror = (err) => {
      if (this.activeRequest !== req || req.dispatchedWorker !== worker || req.settled) return;
      if (this.lockTerminalReason(req, 'errored')) {
        this.consecutiveSpawnFailures++;
        if (this.consecutiveSpawnFailures >= 3) {
          this.isWorkerSupported = false;
        }
        const desErr = new Error(
          `Worker message deserialization failed during "${req.operation}": ${err}`
        );
        this.settleActiveRequest(req, 'reject', desErr);
      }
    };

    worker.onerror = (err) => {
      if (this.activeRequest !== req || req.dispatchedWorker !== worker || req.settled) return;
      if (this.lockTerminalReason(req, 'errored')) {
        this.consecutiveSpawnFailures++;
        if (this.consecutiveSpawnFailures >= 3) {
          this.isWorkerSupported = false;
        }
        const runtimeErr = new Error(
          `PDF Worker runtime error during "${req.operation}": ${err.message || 'unknown error'}`
        );
        this.settleActiveRequest(req, 'reject', runtimeErr);
      }
    };

    // Failure-safe buffer preparation and dispatch
    try {
      const { workerPayload, transferList } = this.prepareTransfer(req.payload);
      worker.postMessage({ id: req.id, operation: req.operation, payload: workerPayload }, transferList);
    } catch (dispatchErr) {
      // Execution DEFINITELY did not begin on worker; caller buffers remain untouched
      this.terminateAndDetachWorker(worker);
      req.dispatchedWorker = null;

      console.warn(
        'Worker transfer preparation or postMessage failed; executing on main thread:',
        dispatchErr
      );
      this.dispatchToMainThread(req);
    }
  }

  /**
   * Executes operation on main thread with internal cooperative signal.
   */
  private dispatchToMainThread(req: InternalRequest): void {
    this.executeOnMainThread(req.operation, req.payload, req.internalController.signal)
      .then((result) => {
        if (this.activeRequest !== req || req.settled) return;

        const won = this.lockTerminalReason(req, 'completed');
        if (won) {
          this.settleActiveRequest(req, 'resolve', result);
        } else {
          // Earlier terminal reason won (caller-aborted or timed-out). Discard late output!
          const terminalErr =
            req.terminalReason === 'timed-out'
              ? new DOMException(
                  `Operation "${req.operation}" timed out after ${req.timeoutMs}ms.`,
                  'TimeoutError'
                )
              : req.callerSignal?.reason ||
                new DOMException('Operation was aborted.', 'AbortError');
          this.settleActiveRequest(req, 'reject', terminalErr);
        }
      })
      .catch((err) => {
        if (this.activeRequest !== req || req.settled) return;

        const won = this.lockTerminalReason(req, 'errored');
        if (won) {
          this.settleActiveRequest(req, 'reject', err);
        } else {
          const terminalErr =
            req.terminalReason === 'timed-out'
              ? new DOMException(
                  `Operation "${req.operation}" timed out after ${req.timeoutMs}ms.`,
                  'TimeoutError'
                )
              : req.callerSignal?.reason ||
                new DOMException('Operation was aborted.', 'AbortError');
          this.settleActiveRequest(req, 'reject', terminalErr);
        }
      });
  }

  /**
   * Settles active request.
   * INVARIANT: Asserts active request identity; terminates dedicated worker; advances queue strictly once.
   */
  private settleActiveRequest(
    expectedActiveReq: InternalRequest,
    action: 'resolve' | 'reject',
    value: Uint8Array | Error
  ): void {
    if (this.activeRequest !== expectedActiveReq || expectedActiveReq.settled) {
      return;
    }

    expectedActiveReq.settled = true;
    expectedActiveReq.state = 'settled';

    if (expectedActiveReq.timer) {
      clearTimeout(expectedActiveReq.timer);
      expectedActiveReq.timer = null;
    }
    if (expectedActiveReq.cleanupCallerAbortListener) {
      expectedActiveReq.cleanupCallerAbortListener();
      expectedActiveReq.cleanupCallerAbortListener = null;
    }

    // Detach and terminate dedicated worker on ANY terminal outcome
    if (expectedActiveReq.dispatchedWorker) {
      this.terminateAndDetachWorker(expectedActiveReq.dispatchedWorker);
      expectedActiveReq.dispatchedWorker = null;
    }

    this.activeRequest = null;

    if (action === 'resolve') {
      expectedActiveReq.resolve(value as Uint8Array);
    } else {
      expectedActiveReq.reject(value as Error);
    }

    // Advance queue strictly once
    this.processQueue();
  }

  private terminateAndDetachWorker(worker: Worker): void {
    try {
      worker.onmessage = null;
      worker.onmessageerror = null;
      worker.onerror = null;
      worker.terminate();
    } catch (e) {
      console.warn('Error detaching/terminating worker:', e);
    }
  }

  private prepareTransfer<T extends PdfOperation>(payload: OperationPayloads[T]) {
    const transferList: Transferable[] = [];
    let workerPayload: OperationPayloads[T];

    if ('buffer' in payload && payload.buffer instanceof Uint8Array) {
      const copy = payload.buffer.slice();
      transferList.push(copy.buffer);
      workerPayload = { ...payload, buffer: copy };
    } else if ('buffers' in payload && Array.isArray(payload.buffers)) {
      const copies = payload.buffers.map((b) => {
        if (b instanceof Uint8Array) {
          const copy = b.slice();
          transferList.push(copy.buffer);
          return copy;
        }
        return b;
      });
      workerPayload = { ...payload, buffers: copies };
    } else if ('images' in payload && Array.isArray(payload.images)) {
      const images = payload.images.map((img) => {
        if (img.bytes instanceof Uint8Array) {
          const copy = img.bytes.slice();
          transferList.push(copy.buffer);
          return { ...img, bytes: copy };
        }
        return img;
      });
      workerPayload = { ...payload, images };
    } else {
      workerPayload = payload;
    }

    return { workerPayload, transferList };
  }

  /**
   * Main-thread fallback execution.
   */
  public async executeOnMainThread<T extends PdfOperation>(
    operation: T,
    payload: OperationPayloads[T],
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    if (signal?.aborted) {
      throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
    }

    switch (operation) {
      case 'merge': {
        const { mergePdfs } = await import('../merge');
        const p = payload as OperationPayloads['merge'];
        return await mergePdfs(p.buffers, p.options, signal);
      }
      case 'rotate': {
        const { rotatePdfPages } = await import('../rotate');
        const p = payload as OperationPayloads['rotate'];
        return await rotatePdfPages(p.buffer, p.options, signal);
      }
      case 'remove-pages': {
        const { removePdfPages } = await import('../remove-pages');
        const p = payload as OperationPayloads['remove-pages'];
        return await removePdfPages(p.buffer, p.pageIndices, signal);
      }
      case 'split': {
        const { splitPdfPages } = await import('../split');
        const p = payload as OperationPayloads['split'];
        const res = await splitPdfPages(p.buffer, p.ranges, p.splitOptions, signal);
        return res.zipBytes;
      }
      case 'images-to-pdf': {
        const { imagesToPdf } = await import('../images-to-pdf');
        const p = payload as OperationPayloads['images-to-pdf'];
        return await imagesToPdf(p.images, p.options, signal);
      }
      case 'compress': {
        const { compressPdf } = await import('../compress');
        const p = payload as OperationPayloads['compress'];
        return await compressPdf(p.buffer, p.options, signal);
      }
      default:
        throw new Error(`Unsupported operation on main thread: ${String(operation)}`);
    }
  }

  /**
   * Clean up worker resources manually if requested.
   */
  public terminateWorker(): void {
    if (this.activeRequest?.dispatchedWorker) {
      this.terminateAndDetachWorker(this.activeRequest.dispatchedWorker);
      this.activeRequest.dispatchedWorker = null;
    }
  }
}

export const pdfProcessingService = new PdfProcessingService();
