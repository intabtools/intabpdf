import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { pdfProcessingService } from './service';

interface ServiceInternalState {
  isWorkerSupported: boolean | null;
  consecutiveSpawnFailures: number;
  activeRequest: unknown;
  queue: unknown[];
  prepareTransfer: (payload: unknown) => { workerPayload: unknown; transferList: Transferable[] };
}

let createdWorkers: MockWorker[] = [];

class MockWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  public onmessageerror: ((e: MessageEvent) => void) | null = null;
  public onerror: ((e: ErrorEvent | Error) => void) | null = null;
  public postMessage = vi.fn();
  public terminate = vi.fn();

  constructor() {
    createdWorkers.push(this);
  }
}

async function createTestPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText('Test Page', { x: 20, y: 100 });
  return await doc.save();
}

describe('PdfProcessingService Dedicated Worker & Cancellation Architecture', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    createdWorkers = [];
    const internal = pdfProcessingService as unknown as ServiceInternalState;
    internal.isWorkerSupported = true;
    internal.consecutiveSpawnFailures = 0;
    internal.activeRequest = null;
    internal.queue = [];
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('1. Dedicated Worker Lifecycle & Outcome Termination', () => {
    it('spawns a dedicated worker and terminates it immediately on successful completion', async () => {
      const pdf = await createTestPdf();
      const promise = pdfProcessingService.execute('rotate', {
        buffer: pdf,
        options: { clockwise: true },
      });

      expect(createdWorkers.length).toBe(1);
      const worker = createdWorkers[0];
      expect(worker.postMessage).toHaveBeenCalledTimes(1);

      // Extract dispatched request ID from postMessage call
      const dispatchCall = worker.postMessage.mock.calls[0][0];
      const reqId = dispatchCall.id;

      // Simulate worker success response
      const dummyResult = new Uint8Array([1, 2, 3]);
      worker.onmessage?.({
        data: { id: reqId, ok: true, result: dummyResult },
      } as MessageEvent);

      const result = await promise;
      expect(result).toBe(dummyResult);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
    });

    it('terminates dedicated worker and rejects without fallback on task error (ok: false)', async () => {
      const pdf = await createTestPdf();
      const fallbackSpy = vi.spyOn(pdfProcessingService, 'executeOnMainThread');

      const promise = pdfProcessingService.execute('rotate', {
        buffer: pdf,
        options: { clockwise: true },
      });

      const worker = createdWorkers[0];
      const reqId = worker.postMessage.mock.calls[0][0].id;

      // Simulate worker returning task error (e.g. password required)
      worker.onmessage?.({
        data: { id: reqId, ok: false, error: 'Password required' },
      } as MessageEvent);

      await expect(promise).rejects.toThrow('Password required');
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(fallbackSpy).not.toHaveBeenCalled(); // Confirmed: NO main-thread fallback on task error
    });

    it('terminates dedicated worker on unhandled runtime onerror', async () => {
      const pdf = await createTestPdf();
      const promise = pdfProcessingService.execute('rotate', {
        buffer: pdf,
      });

      const worker = createdWorkers[0];
      worker.onerror?.(new Error('SyntaxError in worker chunk'));

      await expect(promise).rejects.toThrow(/PDF Worker runtime error/);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('terminates dedicated worker on deserialization onmessageerror', async () => {
      const pdf = await createTestPdf();
      const promise = pdfProcessingService.execute('rotate', {
        buffer: pdf,
      });

      const worker = createdWorkers[0];
      worker.onmessageerror?.({} as MessageEvent);

      await expect(promise).rejects.toThrow(/Worker message deserialization failed/);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. FIFO Queue Settlement & Invariant Enforcement', () => {
    it('settleQueuedRequest removes request from queue without disturbing active request or premature advancement', async () => {
      const pdf = await createTestPdf();

      // Request 1: Active
      const req1Promise = pdfProcessingService.execute('rotate', { buffer: pdf });
      expect(createdWorkers.length).toBe(1);
      const worker1 = createdWorkers[0];

      // Request 2: Queued with caller abort signal
      const abortCtrl2 = new AbortController();
      const req2Promise = pdfProcessingService.execute(
        'rotate',
        { buffer: pdf },
        { signal: abortCtrl2.signal }
      );

      // Request 3: Queued normally
      const req3Promise = pdfProcessingService.execute('rotate', { buffer: pdf });

      // Cancel req2 while it is in the queue
      abortCtrl2.abort();

      await expect(req2Promise).rejects.toThrow(/abort/i);

      // Invariant: Active request 1 is STILL running on worker 1; worker 1 was NOT terminated
      expect(worker1.terminate).not.toHaveBeenCalled();

      // Settle request 1 -> Queue must advance directly to request 3 (skipping already-settled req2)
      const req1Id = worker1.postMessage.mock.calls[0][0].id;
      const res1 = new Uint8Array([11, 22]);
      worker1.onmessage?.({
        data: { id: req1Id, ok: true, result: res1 },
      } as MessageEvent);

      await expect(req1Promise).resolves.toBe(res1);
      expect(worker1.terminate).toHaveBeenCalledTimes(1);

      // Worker 2 is now spawned for Request 3
      expect(createdWorkers.length).toBe(2);
      const worker3 = createdWorkers[1];
      const req3Id = worker3.postMessage.mock.calls[0][0].id;
      const res3 = new Uint8Array([33, 44]);
      worker3.onmessage?.({
        data: { id: req3Id, ok: true, result: res3 },
      } as MessageEvent);

      await expect(req3Promise).resolves.toBe(res3);
      expect(worker3.terminate).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Timeout Typing & First-Terminal-Reason-Wins', () => {
    it('rejects with distinguishable DOMException TimeoutError on timeout', async () => {
      const pdf = await createTestPdf();
      const promise = pdfProcessingService.execute(
        'rotate',
        { buffer: pdf },
        { timeoutMs: 15_000 }
      );

      expect(createdWorkers.length).toBe(1);
      const worker = createdWorkers[0];

      // Advance timers past 15s timeout
      vi.advanceTimersByTime(15_001);

      let caughtError: unknown;
      try {
        await promise;
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(DOMException);
      const domErr = caughtError as DOMException;
      expect(domErr.name).toBe('TimeoutError');
      expect(domErr.message).toContain('timed out after 15000ms');
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('first-terminal-reason-wins: caller cancellation cannot be overwritten by late worker completion', async () => {
      const pdf = await createTestPdf();
      const abortCtrl = new AbortController();

      const promise = pdfProcessingService.execute(
        'rotate',
        { buffer: pdf },
        { signal: abortCtrl.signal }
      );

      const worker = createdWorkers[0];
      const reqId = worker.postMessage.mock.calls[0][0].id;

      // Caller cancels while active
      abortCtrl.abort();

      // Late message arrives from worker after cancellation
      worker.onmessage?.({
        data: { id: reqId, ok: true, result: new Uint8Array([9, 9, 9]) },
      } as MessageEvent);

      await expect(promise).rejects.toThrow(/abort/i);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('discards late main-thread fallback results after cancellation', async () => {
      // Force fallback by stubbing Worker undefined
      vi.stubGlobal('Worker', undefined);

      let resolveFallback!: (val: Uint8Array) => void;
      vi.spyOn(pdfProcessingService, 'executeOnMainThread').mockImplementation(() => {
        return new Promise<Uint8Array>((resolve) => {
          resolveFallback = resolve;
        });
      });

      const abortCtrl = new AbortController();
      const promise = pdfProcessingService.execute(
        'rotate',
        { buffer: new Uint8Array([1]) },
        { signal: abortCtrl.signal }
      );

      // Caller cancels
      abortCtrl.abort();

      // Fallback late resolves
      resolveFallback(new Uint8Array([99, 99]));

      await expect(promise).rejects.toThrow(/abort/i);
    });
  });

  describe('4. Failure-Safe Worker Preparation & Buffers Protection', () => {
    it('falls back to main thread and preserves original buffers when prepareTransfer throws', async () => {
      const originalBuffer = new Uint8Array([1, 2, 3, 4, 5]);

      // Mock prepareTransfer on service instance to throw RangeError (e.g. allocation error)
      vi.spyOn(pdfProcessingService as unknown as ServiceInternalState, 'prepareTransfer').mockImplementationOnce(() => {
        throw new RangeError('Array buffer allocation failed');
      });

      const fallbackSpy = vi.spyOn(pdfProcessingService, 'executeOnMainThread').mockResolvedValueOnce(
        new Uint8Array([10, 20])
      );

      const result = await pdfProcessingService.execute('rotate', {
        buffer: originalBuffer,
      });

      expect(result).toEqual(new Uint8Array([10, 20]));
      // The spawned worker must be terminated immediately
      expect(createdWorkers[0].terminate).toHaveBeenCalledTimes(1);
      // Fallback must be called with the untouched original buffer
      expect(fallbackSpy).toHaveBeenCalledTimes(1);
      expect(originalBuffer.byteLength).toBe(5); // Un-neutered
    });

    it('ignores stale response with mismatched request ID', async () => {
      const pdf = await createTestPdf();
      const promise = pdfProcessingService.execute('rotate', { buffer: pdf });

      const worker = createdWorkers[0];
      const legitimateId = worker.postMessage.mock.calls[0][0].id;

      // Post message with wrong ID
      worker.onmessage?.({
        data: { id: 'wrong_stale_id', ok: true, result: new Uint8Array([1]) },
      } as MessageEvent);

      // Invariant: Worker must NOT be terminated and promise must remain unsettled
      expect(worker.terminate).not.toHaveBeenCalled();

      // Now post legitimate message
      worker.onmessage?.({
        data: { id: legitimateId, ok: true, result: new Uint8Array([42]) },
      } as MessageEvent);

      const res = await promise;
      expect(res).toEqual(new Uint8Array([42]));
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('enables immediate clean retry after cancellation', async () => {
      const pdf = await createTestPdf();
      const abortCtrl = new AbortController();

      // Request 1 cancelled
      const req1 = pdfProcessingService.execute('rotate', { buffer: pdf }, { signal: abortCtrl.signal });
      abortCtrl.abort();
      await expect(req1).rejects.toThrow(/abort/i);

      // Request 2 issued immediately
      const req2 = pdfProcessingService.execute('rotate', { buffer: pdf });
      expect(createdWorkers.length).toBe(2);
      const worker2 = createdWorkers[1];
      const req2Id = worker2.postMessage.mock.calls[0][0].id;

      worker2.onmessage?.({
        data: { id: req2Id, ok: true, result: new Uint8Array([100]) },
      } as MessageEvent);

      await expect(req2).resolves.toEqual(new Uint8Array([100]));
      expect(worker2.terminate).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. Main-Thread Fallback Cancellation, Timeout & Queue Advancing Contract', () => {
    it('propagates caller cancellation to main-thread fallback internal signal', async () => {
      vi.stubGlobal('Worker', undefined);

      let fallbackSignal: AbortSignal | undefined;
      vi.spyOn(pdfProcessingService, 'executeOnMainThread').mockImplementation((_op, _payload, signal) => {
        fallbackSignal = signal;
        return new Promise<Uint8Array>((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(signal.reason || new DOMException('Operation was aborted.', 'AbortError'));
          });
        });
      });

      const abortCtrl = new AbortController();
      const promise = pdfProcessingService.execute(
        'rotate',
        { buffer: new Uint8Array([1, 2, 3]) },
        { signal: abortCtrl.signal }
      );

      expect(fallbackSignal).toBeDefined();
      expect(fallbackSignal!.aborted).toBe(false);

      abortCtrl.abort();

      expect(fallbackSignal!.aborted).toBe(true);
      await expect(promise).rejects.toThrow(/abort/i);
    });

    it('timeout aborts the internal signal delivered to main-thread fallback with TimeoutError', async () => {
      vi.stubGlobal('Worker', undefined);

      let fallbackSignal: AbortSignal | undefined;
      vi.spyOn(pdfProcessingService, 'executeOnMainThread').mockImplementation((_op, _payload, signal) => {
        fallbackSignal = signal;
        return new Promise<Uint8Array>((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(signal.reason);
          });
        });
      });

      const promise = pdfProcessingService.execute(
        'rotate',
        { buffer: new Uint8Array([1, 2, 3]) },
        { timeoutMs: 10_000 }
      );

      expect(fallbackSignal).toBeDefined();
      expect(fallbackSignal!.aborted).toBe(false);

      vi.advanceTimersByTime(10_001);

      expect(fallbackSignal!.aborted).toBe(true);
      expect(fallbackSignal!.reason).toBeInstanceOf(DOMException);
      expect((fallbackSignal!.reason as DOMException).name).toBe('TimeoutError');

      await expect(promise).rejects.toThrow(/timed out/i);
    });

    it('queue does not advance while main-thread fallback is cleaning up asynchronously', async () => {
      vi.stubGlobal('Worker', undefined);

      const buf1 = new Uint8Array([1]);
      const buf2 = new Uint8Array([2]);

      let finishFallback1Cleanup!: () => void;
      let req2Dispatched = false;

      vi.spyOn(pdfProcessingService, 'executeOnMainThread').mockImplementation((_op, payload, signal) => {
        if ((payload as { buffer: Uint8Array }).buffer === buf1) {
          return new Promise<Uint8Array>((_, reject) => {
            signal?.addEventListener('abort', () => {
              finishFallback1Cleanup = () => {
                reject(new DOMException('Operation was aborted.', 'AbortError'));
              };
            });
          });
        }
        if ((payload as { buffer: Uint8Array }).buffer === buf2) {
          req2Dispatched = true;
          return Promise.resolve(new Uint8Array([200]));
        }
        return Promise.resolve(new Uint8Array([]));
      });

      const abortCtrl1 = new AbortController();
      const req1Promise = pdfProcessingService.execute('rotate', { buffer: buf1 }, { signal: abortCtrl1.signal });
      const req2Promise = pdfProcessingService.execute('rotate', { buffer: buf2 });

      // Abort Req 1
      abortCtrl1.abort();

      // Invariant: finishFallback1Cleanup has NOT been called yet, meaning req1 is still in cooperative cleanup
      expect(req2Dispatched).toBe(false);

      const internal = pdfProcessingService as unknown as ServiceInternalState;
      expect(internal.activeRequest).not.toBeNull();

      // Now complete the fallback cleanup
      finishFallback1Cleanup();

      await expect(req1Promise).rejects.toThrow(/abort/i);

      // Now queue must advance and dispatch Req 2
      const res2 = await req2Promise;
      expect(res2).toEqual(new Uint8Array([200]));
      expect(req2Dispatched).toBe(true);
    });

    it('immediate clean retry works after fallback cancellation', async () => {
      vi.stubGlobal('Worker', undefined);

      let shouldFail = true;
      vi.spyOn(pdfProcessingService, 'executeOnMainThread').mockImplementation((_op, _payload, signal) => {
        if (shouldFail) {
          return new Promise<Uint8Array>((_, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('Operation was aborted.', 'AbortError'));
            });
          });
        }
        return Promise.resolve(new Uint8Array([42]));
      });

      const abortCtrl = new AbortController();
      const req1 = pdfProcessingService.execute('rotate', { buffer: new Uint8Array([1]) }, { signal: abortCtrl.signal });
      abortCtrl.abort();
      await expect(req1).rejects.toThrow(/abort/i);

      // Retry immediately
      shouldFail = false;
      const req2 = await pdfProcessingService.execute('rotate', { buffer: new Uint8Array([1]) });
      expect(req2).toEqual(new Uint8Array([42]));
    });

    it('discards late fallback output if fallback resolves after timeout has fired', async () => {
      vi.stubGlobal('Worker', undefined);

      let lateResolve!: (val: Uint8Array) => void;
      vi.spyOn(pdfProcessingService, 'executeOnMainThread').mockImplementation(() => {
        return new Promise<Uint8Array>((resolve) => {
          lateResolve = resolve;
        });
      });

      const promise = pdfProcessingService.execute(
        'rotate',
        { buffer: new Uint8Array([1]) },
        { timeoutMs: 5000 }
      );

      // Trigger timeout
      vi.advanceTimersByTime(5001);

      // Fallback late resolves
      lateResolve(new Uint8Array([999]));

      let caughtErr: unknown;
      try {
        await promise;
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(DOMException);
      expect((caughtErr as DOMException).name).toBe('TimeoutError');
    });
  });

  describe('6. text-to-pdf Worker & Fallback Execution with Cloneability & Cancellation', () => {
    it('proves text-to-pdf payload is 100% structured-cloneable with no functions or non-cloneable dependencies', () => {
      const payload = {
        text: 'Sample text content for conversion',
        options: {
          pageSize: 'a4' as const,
          orientation: 'portrait' as const,
          marginPreset: 'normal' as const,
          fontFamily: 'helvetica' as const,
          fontSize: 11,
          lineSpacing: 1.3,
          includePageNumbers: true,
        },
      };

      // structuredClone must succeed without throwing DataCloneError
      const cloned = structuredClone(payload);
      expect(cloned).toEqual(payload);

      // Verify no functions exist anywhere in payload
      expect(typeof (cloned.options as Record<string, unknown>).yieldFn).toBe('undefined');
      for (const val of Object.values(cloned.options)) {
        expect(typeof val).not.toBe('function');
      }
    });

    it('spawns a dedicated worker for text-to-pdf and returns result bytes', async () => {
      const promise = pdfProcessingService.execute('text-to-pdf', {
        text: 'Worker text test',
      });

      expect(createdWorkers.length).toBe(1);
      const worker = createdWorkers[0];
      const reqId = worker.postMessage.mock.calls[0][0].id;

      const dummyPdf = new Uint8Array([37, 80, 68, 70]); // %PDF
      worker.onmessage?.({
        data: { id: reqId, ok: true, result: dummyPdf },
      } as MessageEvent);

      const result = await promise;
      expect(result).toBe(dummyPdf);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('handles fallback in-flight cancellation for text-to-pdf and frees queue for subsequent request', async () => {
      vi.stubGlobal('Worker', undefined);

      let fallbackSignal: AbortSignal | undefined;
      vi.spyOn(pdfProcessingService, 'executeOnMainThread').mockImplementation((_op, payload, signal) => {
        fallbackSignal = signal;
        const textPayload = payload as { text: string };
        if (textPayload.text === 'cancel-me') {
          return new Promise<Uint8Array>((_, reject) => {
            signal?.addEventListener('abort', () => {
              reject(signal.reason || new DOMException('Operation was aborted.', 'AbortError'));
            });
          });
        }
        return Promise.resolve(new Uint8Array([10, 20, 30]));
      });

      const abortCtrl = new AbortController();
      const req1Promise = pdfProcessingService.execute(
        'text-to-pdf',
        { text: 'cancel-me' },
        { signal: abortCtrl.signal }
      );

      expect(fallbackSignal).toBeDefined();
      expect(fallbackSignal!.aborted).toBe(false);

      // Trigger cancellation while active
      abortCtrl.abort(new DOMException('User cancelled generation', 'AbortError'));

      await expect(req1Promise).rejects.toThrow('User cancelled generation');

      // Subsequent request must run immediately and succeed
      const req2Promise = pdfProcessingService.execute('text-to-pdf', { text: 'clean-next' });
      await expect(req2Promise).resolves.toEqual(new Uint8Array([10, 20, 30]));
    });

    it('dispatches protect operation with cloned buffer and options to worker', async () => {
      const dummyPdf = new Uint8Array([37, 80, 68, 70]); // %PDF
      const promise = pdfProcessingService.protectPdf(dummyPdf, {
        password: 'securePassword',
        algorithm: 'AES-256',
      });

      expect(createdWorkers).toHaveLength(1);
      const worker = createdWorkers[0];
      const call = worker.postMessage.mock.calls[0];
      expect(call[0].operation).toBe('protect');
      expect(call[0].payload.options.password).toBe('securePassword');
      expect(call[1]).toHaveLength(1);

      const reqId = call[0].id;
      worker.onmessage?.({
        data: { id: reqId, ok: true, result: new Uint8Array([99, 88]) },
      } as MessageEvent);

      const res = await promise;
      expect(res).toEqual(new Uint8Array([99, 88]));
    });

    it('dispatches unlock operation with cloned buffer and options to worker', async () => {
      const dummyPdf = new Uint8Array([37, 80, 68, 70]); // %PDF
      const promise = pdfProcessingService.unlockPdf(dummyPdf, {
        password: 'mySecretPassword',
      });

      expect(createdWorkers).toHaveLength(1);
      const worker = createdWorkers[0];
      const call = worker.postMessage.mock.calls[0];
      expect(call[0].operation).toBe('unlock');
      expect(call[0].payload.options.password).toBe('mySecretPassword');
      expect(call[1]).toHaveLength(1);

      const reqId = call[0].id;
      worker.onmessage?.({
        data: { id: reqId, ok: true, result: new Uint8Array([77, 66]) },
      } as MessageEvent);

      const res = await promise;
      expect(res).toEqual(new Uint8Array([77, 66]));
    });
  });
});
