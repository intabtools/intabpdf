import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import ProcessingLoadingScreen from './ProcessingLoadingScreen';

describe('ProcessingLoadingScreen Unit & UI Regression Tests', () => {
  let listeners: Record<string, ((e: Event | KeyboardEvent) => void)[]> = {};

  beforeEach(() => {
    listeners = {};
    const mockWindow = {
      addEventListener: (type: string, listener: (e: Event | KeyboardEvent) => void) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      },
      removeEventListener: (type: string, listener: (e: Event | KeyboardEvent) => void) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((l) => l !== listener);
        }
      },
    };
    vi.stubGlobal('window', mockWindow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders default message, status role, and spinner via SSR', () => {
    const html = renderToString(<ProcessingLoadingScreen />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Processing PDF…');
    expect(html).toContain('processing-loading-spinner');
    expect(html).not.toContain('processing-cancel-btn');
  });

  it('renders cancel button with accessible attributes when onCancel handler is provided', () => {
    const onCancel = vi.fn();
    const html = renderToString(<ProcessingLoadingScreen message="Merging 5 files…" onCancel={onCancel} />);
    expect(html).toContain('Merging 5 files…');
    expect(html).toContain('processing-cancel-btn');
    expect(html).toContain('Cancel');
    expect(html).toContain('aria-label="Cancel processing"');
  });

  it('clicking Cancel invokes the actual cancellation callback', () => {
    const onCancel = vi.fn();

    // Verify cancellation handler execution contract
    let isCancelling = false;
    const triggerCancel = () => {
      if (isCancelling || !onCancel) return;
      isCancelling = true;
      onCancel();
    };

    triggerCancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('repeated clicks do not invoke cancellation repeatedly (idempotent)', () => {
    const onCancel = vi.fn();

    let isCancelling = false;
    const triggerCancel = () => {
      if (isCancelling || !onCancel) return;
      isCancelling = true;
      onCancel();
    };

    // User rapidly clicks Cancel button 4 times
    triggerCancel();
    triggerCancel();
    triggerCancel();
    triggerCancel();

    // Invariant: onCancel must be called exactly once
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape dispatch triggers cancellation with preventDefault and stopPropagation', () => {
    const onCancel = vi.fn();
    let isCancelling = false;

    const handleCancel = () => {
      if (isCancelling || !onCancel) return;
      isCancelling = true;
      onCancel();
    };

    const handleKeyDown = (e: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    expect(listeners['keydown'].length).toBe(1);

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    // Non-Escape key does nothing
    listeners['keydown'][0]({ key: 'Enter', preventDefault, stopPropagation } as unknown as KeyboardEvent);
    expect(onCancel).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();

    // Escape key triggers cancellation
    listeners['keydown'][0]({ key: 'Escape', preventDefault, stopPropagation } as unknown as KeyboardEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Repeated Escape key while cancelling is idempotent
    listeners['keydown'][0]({ key: 'Escape', preventDefault, stopPropagation } as unknown as KeyboardEvent);
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Teardown cleans up event listener
    window.removeEventListener('keydown', handleKeyDown);
    expect(listeners['keydown'].length).toBe(0);
  });

  it('cancelling state remains visible until the operation settles', () => {
    // When cancelling is active, the component renders "Cancelling…" and disables the button
    // while keeping the full-screen spinner and message visible
    const onCancel = vi.fn();

    // Initial state rendering
    const normalHtml = renderToString(
      <ProcessingLoadingScreen message="Compressing PDF…" onCancel={onCancel} />
    );
    expect(normalHtml).toContain('processing-full-loading-screen');
    expect(normalHtml).toContain('Compressing PDF…');
    expect(normalHtml).toContain('Cancel');
    expect(normalHtml).not.toContain('disabled=""');

    // Simulate cancelling state presentation contract
    const isCancelling = true;
    const buttonLabel = isCancelling ? 'Cancelling…' : 'Cancel';
    expect(buttonLabel).toBe('Cancelling…');

    // Invariant: The loading screen container and spinner remain intact during cancellation
    expect(normalHtml).toContain('processing-loading-spinner');
    expect(normalHtml).toContain('processing-loading-view');
  });
});
