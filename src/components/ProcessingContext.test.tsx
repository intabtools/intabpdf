import { describe, expect, it } from 'vitest';
import { useContext } from 'react';
import { renderToString } from 'react-dom/server';
import { ProcessingProvider } from './ProcessingContext';
import { ProcessingContext, type ProcessingContextType } from './processingContextDef';

function setupContext(): ProcessingContextType {
  let ctx: ProcessingContextType | null = null;
  function Consumer() {
    ctx = useContext(ProcessingContext);
    return null;
  }

  renderToString(
    <ProcessingProvider>
      <Consumer />
    </ProcessingProvider>
  );

  if (!ctx) {
    throw new Error('ProcessingContext was not provided');
  }

  return ctx;
}

describe('ProcessingContext Targeted Regression Tests', () => {
  it('rejects overlapping operations without aborting the active operation', async () => {
    const ctx = setupContext();

    let resolveTask1!: (val: string) => void;
    const task1Promise = new Promise<string>((resolve) => {
      resolveTask1 = resolve;
    });

    let task1Signal!: AbortSignal;
    const op1 = ctx.runWithProcessing('Operation 1', async (signal) => {
      task1Signal = signal;
      return await task1Promise;
    });

    // Micro-yield to allow op1 to mark isBusyRef.current = true
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Attempt overlapping operation 2 while operation 1 is active
    let op2Error: unknown;
    try {
      await ctx.runWithProcessing('Operation 2', async () => 'op2-result');
    } catch (err) {
      op2Error = err;
    }

    expect(op2Error).toBeInstanceOf(Error);
    expect((op2Error as Error).message).toContain('Another operation is already in progress');

    // Invariant: Operation 1's signal was NOT aborted by the rejected overlapping attempt
    expect(task1Signal.aborted).toBe(false);

    // Complete operation 1 successfully
    resolveTask1('op1-success');
    const result1 = await op1;
    expect(result1).toBe('op1-success');
  });

  it('cancel aborts the active signal and notifies listeners', async () => {
    const ctx = setupContext();

    let abortedTriggered = false;
    let abortReason: unknown;

    const op = ctx.runWithProcessing('Cancellable Operation', async (signal) => {
      signal.addEventListener('abort', () => {
        abortedTriggered = true;
        abortReason = signal.reason;
      });

      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason || new DOMException('Operation was aborted.', 'AbortError'));
        });
      });
    });

    // Micro-yield to allow setup
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Trigger cancellation
    ctx.cancelProcessing?.();

    await expect(op).rejects.toThrow();
    expect(abortedTriggered).toBe(true);
    expect(abortReason).toBeDefined();
  });

  it('repeated cancellation calls are safe and idempotent', async () => {
    const ctx = setupContext();

    let abortCount = 0;
    const op = ctx.runWithProcessing('Task', async (signal) => {
      signal.addEventListener('abort', () => {
        abortCount++;
      });

      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Operation was aborted.', 'AbortError'));
        });
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    // Call cancelProcessing repeatedly
    ctx.cancelProcessing?.();
    ctx.cancelProcessing?.();
    ctx.cancelProcessing?.();

    await expect(op).rejects.toThrow();
    // Signal abort event fires exactly once
    expect(abortCount).toBe(1);

    // Calling cancelProcessing after task has already settled does nothing and does not throw
    expect(() => ctx.cancelProcessing?.()).not.toThrow();
  });

  it('context returns to idle after success, failure, and cancellation', async () => {
    const ctx = setupContext();

    // 1. Success returns to idle
    const res1 = await ctx.runWithProcessing('Success Task', async () => 'done');
    expect(res1).toBe('done');

    // Immediately run another task to verify idle state
    const res2 = await ctx.runWithProcessing('Follow-up Task', async () => 'next');
    expect(res2).toBe('next');

    // 2. Failure returns to idle
    await expect(
      ctx.runWithProcessing('Failing Task', async () => {
        throw new Error('Task internal failure');
      })
    ).rejects.toThrow('Task internal failure');

    // Immediately run another task to verify idle state
    const res3 = await ctx.runWithProcessing('After Failure Task', async () => 'recovered');
    expect(res3).toBe('recovered');

    // 3. Cancellation returns to idle
    const cancelOp = ctx.runWithProcessing('Cancel Task', async (signal) => {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Operation was aborted.', 'AbortError'));
        });
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    ctx.cancelProcessing?.();
    await expect(cancelOp).rejects.toThrow();

    // Immediately run another task to verify idle state
    const res4 = await ctx.runWithProcessing('After Cancel Task', async () => 'ready');
    expect(res4).toBe('ready');
  });

  it('a new operation can start after cancellation settles', async () => {
    const ctx = setupContext();

    // Start Task A
    const taskA = ctx.runWithProcessing('Task A', async (signal) => {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Operation was aborted.', 'AbortError'));
        });
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    // Cancel Task A
    ctx.cancelProcessing?.();
    await expect(taskA).rejects.toThrow();

    // Start Task B immediately
    let taskBSignal!: AbortSignal;
    const taskB = await ctx.runWithProcessing('Task B', async (signal) => {
      taskBSignal = signal;
      return 'task-b-complete';
    });

    expect(taskB).toBe('task-b-complete');
    // Task B owns a fresh, non-aborted controller
    expect(taskBSignal.aborted).toBe(false);
  });
});
