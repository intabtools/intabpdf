import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RouteScrollStore,
  computeRouteScrollAction,
  scheduleBoundedScrollRestore,
} from './useRouteScrollRestoration';

describe('useRouteScrollRestoration helpers', () => {
  it('resets to top on PUSH and REPLACE unless a valid hash target exists', () => {
    expect(
      computeRouteScrollAction({
        navigationType: 'PUSH',
        savedPosition: 450,
        hasValidHashTarget: false,
      }),
    ).toEqual({ mode: 'top', targetTop: 0 });

    expect(
      computeRouteScrollAction({
        navigationType: 'REPLACE',
        savedPosition: 300,
        hasValidHashTarget: false,
      }),
    ).toEqual({ mode: 'top', targetTop: 0 });

    expect(
      computeRouteScrollAction({
        navigationType: 'PUSH',
        savedPosition: 0,
        hasValidHashTarget: true,
      }),
    ).toEqual({ mode: 'hash', targetTop: 0 });
  });

  it('restores saved scroll position on POP navigation and defaults to 0 when absent', () => {
    expect(
      computeRouteScrollAction({
        navigationType: 'POP',
        savedPosition: 380,
      }),
    ).toEqual({ mode: 'restore', targetTop: 380 });

    expect(
      computeRouteScrollAction({
        navigationType: 'POP',
      }),
    ).toEqual({ mode: 'restore', targetTop: 0 });
  });

  it('evicts oldest keys in RouteScrollStore when exceeding maxEntries and normalizes negatives', () => {
    const store = new RouteScrollStore(3);
    store.set('k1', 120);
    store.set('k2', 240);
    store.set('k3', -50);
    expect(store.get('k3')).toBe(0);
    expect(store.size).toBe(3);

    // Updating k1 refreshes LRU order so k2 becomes oldest and is evicted when k4 is added
    store.set('k1', 150);
    store.set('k4', 500);
    expect(store.size).toBe(3);
    expect(store.get('k1')).toBe(150);
    expect(store.get('k2')).toBeUndefined();
    expect(store.get('k3')).toBe(0);
    expect(store.get('k4')).toBe(500);
  });
});

describe('scheduleBoundedScrollRestore', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('restores scroll position via ResizeObserver once lazy content exceeds targetTop', () => {
    vi.useFakeTimers();
    const resizeState: { cb: (() => void) | null } = { cb: null };
    const observed: unknown[] = [];
    const disconnected = vi.fn();

    vi.stubGlobal(
      'ResizeObserver',
      class FakeResizeObserver {
        constructor(cb: () => void) {
          resizeState.cb = cb;
        }
        observe(target: unknown) {
          observed.push(target);
        }
        disconnect() {
          disconnected();
        }
      },
    );

    const headerEl = { tagName: 'HEADER' };
    const mainEl = { tagName: 'MAIN' };
    const footerEl = { tagName: 'FOOTER' };
    const listeners = new Map<string, Set<() => void>>();
    const container = {
      scrollHeight: 400,
      clientHeight: 300,
      scrollTop: 0,
      firstElementChild: headerEl,
      children: [headerEl, mainEl, footerEl],
      addEventListener: (type: string, fn: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners.get(type)?.delete(fn);
      },
    } as unknown as HTMLElement;

    const settled = vi.fn();
    scheduleBoundedScrollRestore(container, 450, { timeoutMs: 1200, onSettled: settled });
    expect(container.scrollTop).toBe(0);
    // Verifies WebShell sibling children (e.g., <main> + <footer> beyond <header>) are observed
    expect(observed).toContain(container);
    expect(observed).toContain(mainEl);
    expect(observed).toContain(footerEl);

    // Simulate slow lazy chunk mounting after 500ms (> old 18-frame limit)
    vi.advanceTimersByTime(500);
    Object.defineProperty(container, 'scrollHeight', { value: 1200, configurable: true });
    resizeState.cb?.();

    expect(container.scrollTop).toBe(450);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('aborts restoration immediately on user input and honors bounded timeout fallback', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'ResizeObserver',
      class FakeResizeObserver {
        observe() {}
        disconnect() {}
      },
    );

    const listeners = new Map<string, Set<() => void>>();
    const container = {
      scrollHeight: 400,
      clientHeight: 300,
      scrollTop: 0,
      firstElementChild: null,
      addEventListener: (type: string, fn: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners.get(type)?.delete(fn);
      },
    } as unknown as HTMLElement;

    const settledUser = vi.fn();
    scheduleBoundedScrollRestore(container, 450, { timeoutMs: 1000, onSettled: settledUser });
    // User wheels before async content finishes loading
    for (const fn of listeners.get('wheel') ?? []) fn();
    expect(settledUser).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    expect(container.scrollTop).toBe(0);

    // Timeout case: clamps cleanly at available scrollable height without polling forever
    const container2 = {
      scrollHeight: 550,
      clientHeight: 300,
      scrollTop: 0,
      firstElementChild: null,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLElement;
    const settledTimeout = vi.fn();
    scheduleBoundedScrollRestore(container2, 450, { timeoutMs: 600, onSettled: settledTimeout });
    vi.advanceTimersByTime(600);
    expect(container2.scrollTop).toBe(250);
    expect(settledTimeout).toHaveBeenCalledTimes(1);
  });
});
