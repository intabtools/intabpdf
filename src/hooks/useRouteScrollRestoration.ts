// Route-aware scroll isolation and history scroll restoration for shell scroll containers.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const DEFAULT_MAX_ENTRIES = 100;
export const DEFAULT_POP_RESTORE_TIMEOUT_MS = 1500;

export interface BoundedScrollRestoreOptions {
  timeoutMs?: number;
  onSettled?: () => void;
}

/**
 * Restores saved scrollTop on POP navigation cleanly as soon as async/lazy
 * content grows enough to accommodate targetTop, bounded by a timeout and
 * cancelled immediately upon user input so navigation stays responsive.
 */
export function scheduleBoundedScrollRestore(
  container: HTMLElement,
  targetTop: number,
  options: BoundedScrollRestoreOptions = {},
): () => void {
  const timeoutMs = options.timeoutMs ?? DEFAULT_POP_RESTORE_TIMEOUT_MS;
  let settled = false;
  let rafId = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const cancelListeners: Array<() => void> = [];

  const cleanup = () => {
    if (rafId && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    for (const off of cancelListeners) {
      off();
    }
    cancelListeners.length = 0;
  };

  const finish = (applyFinalClamp: boolean) => {
    if (settled) return;
    settled = true;
    if (applyFinalClamp) {
      const maxScrollable = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = Math.min(targetTop, maxScrollable);
    }
    cleanup();
    options.onSettled?.();
  };

  const tryRestore = (): boolean => {
    if (settled) return true;
    const maxScrollable = Math.max(0, container.scrollHeight - container.clientHeight);
    if (maxScrollable >= targetTop) {
      container.scrollTop = targetTop;
      finish(false);
      return true;
    }
    return false;
  };

  if (tryRestore()) {
    return () => {
      settled = true;
      cleanup();
    };
  }

  const abortOnUserIntent = () => finish(false);
  const abortOnScrollKey = (e: KeyboardEvent) => {
    if (
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'PageDown' ||
      e.key === 'PageUp' ||
      e.key === 'Home' ||
      e.key === 'End' ||
      e.key === ' '
    ) {
      abortOnUserIntent();
    }
  };

  container.addEventListener('wheel', abortOnUserIntent, { passive: true, once: true });
  container.addEventListener('touchstart', abortOnUserIntent, { passive: true, once: true });
  container.addEventListener('pointerdown', abortOnUserIntent, { passive: true, once: true });
  cancelListeners.push(
    () => container.removeEventListener('wheel', abortOnUserIntent),
    () => container.removeEventListener('touchstart', abortOnUserIntent),
    () => container.removeEventListener('pointerdown', abortOnUserIntent),
  );

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', abortOnScrollKey, { passive: true });
    cancelListeners.push(() => window.removeEventListener('keydown', abortOnScrollKey));
  }

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      void tryRestore();
    });
    resizeObserver.observe(container);
    const childElements = container.children ? Array.from(container.children) : [];
    for (const child of childElements) {
      resizeObserver.observe(child);
    }
    if (childElements.length === 0 && container.firstElementChild) {
      resizeObserver.observe(container.firstElementChild);
    }
  } else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    const poll = () => {
      if (settled) return;
      if (!tryRestore()) {
        rafId = window.requestAnimationFrame(poll);
      }
    };
    rafId = window.requestAnimationFrame(poll);
  }

  timeoutId = setTimeout(() => finish(true), timeoutMs);

  return () => {
    settled = true;
    cleanup();
  };
}

/**
 * Bounded in-memory LRU/FIFO scroll offset store keyed by router location key.
 */
export class RouteScrollStore {
  private readonly maxEntries: number;
  private readonly positions = new Map<string, number>();

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get(key: string): number | undefined {
    return this.positions.get(key);
  }

  set(key: string, scrollTop: number): void {
    const normalized = Math.max(0, Math.round(scrollTop));
    if (this.positions.has(key)) {
      this.positions.delete(key);
    } else if (this.positions.size >= this.maxEntries) {
      const oldestKey = this.positions.keys().next().value;
      if (oldestKey !== undefined) {
        this.positions.delete(oldestKey);
      }
    }
    this.positions.set(key, normalized);
  }

  get size(): number {
    return this.positions.size;
  }

  clear(): void {
    this.positions.clear();
  }
}

export interface ComputeScrollTargetOptions {
  navigationType: 'POP' | 'PUSH' | 'REPLACE' | string;
  savedPosition?: number;
  hasValidHashTarget?: boolean;
}

export function computeRouteScrollAction(
  options: ComputeScrollTargetOptions,
): { mode: 'hash' | 'top' | 'restore'; targetTop: number } {
  const { navigationType, savedPosition = 0, hasValidHashTarget = false } = options;

  if (navigationType === 'POP') {
    return { mode: 'restore', targetTop: Math.max(0, savedPosition) };
  }
  if (hasValidHashTarget) {
    return { mode: 'hash', targetTop: 0 };
  }
  return { mode: 'top', targetTop: 0 };
}

function findHashTarget(hash: string): HTMLElement | null {
  if (!hash || hash.length <= 1 || typeof document === 'undefined') return null;
  const rawId = hash.slice(1);
  try {
    const decoded = decodeURIComponent(rawId);
    return document.getElementById(decoded) || document.getElementById(rawId);
  } catch {
    return document.getElementById(rawId);
  }
}

export interface UseRouteScrollRestorationOptions {
  disabled?: boolean;
}

/**
 * Ensures persistent shell scroll containers reset to 0 on PUSH/REPLACE routes
 * and restore saved offsets on POP (back/forward) transitions once content renders.
 */
export function useRouteScrollRestoration(
  containerRef: RefObject<HTMLElement | null>,
  options: UseRouteScrollRestorationOptions = {},
): void {
  const { disabled = false } = options;
  const location = useLocation();
  const navigationType = useNavigationType();
  const locationKey = location.key || `${location.pathname}${location.search}`;

  const [store] = useState(() => new RouteScrollStore());
  const activeKeyRef = useRef<string>(locationKey);
  const isRestoringRef = useRef(false);

  // Track passive user scroll offset for the currently active route key
  useEffect(() => {
    activeKeyRef.current = locationKey;
    const container = containerRef.current;
    if (!container || disabled) return;

    const handleScroll = () => {
      if (isRestoringRef.current) return;
      store.set(activeKeyRef.current, container.scrollTop);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef, locationKey, disabled, store]);

  // Apply PUSH/REPLACE reset or POP restoration when route key/pathname changes
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) {
      if (container && disabled) {
        container.scrollTop = 0;
      }
      return;
    }

    const hashTarget = findHashTarget(location.hash);
    const saved = store.get(locationKey) ?? 0;
    const plan = computeRouteScrollAction({
      navigationType,
      savedPosition: saved,
      hasValidHashTarget: Boolean(hashTarget),
    });

    if (plan.mode === 'hash' && hashTarget) {
      isRestoringRef.current = true;
      hashTarget.scrollIntoView({ block: 'start' });
      const timer = setTimeout(() => {
        isRestoringRef.current = false;
      }, 60);
      return () => {
        clearTimeout(timer);
        isRestoringRef.current = false;
      };
    }

    if (plan.mode === 'top') {
      isRestoringRef.current = true;
      container.scrollTop = 0;
      store.set(locationKey, 0);
      const timer = setTimeout(() => {
        isRestoringRef.current = false;
      }, 30);
      return () => {
        clearTimeout(timer);
        isRestoringRef.current = false;
      };
    }

    // POP navigation: adaptively restore once async/lazy layout grows (ResizeObserver + bounded timeout)
    const targetTop = plan.targetTop;
    if (targetTop <= 0) {
      container.scrollTop = 0;
      return;
    }

    isRestoringRef.current = true;
    const cancelRestore = scheduleBoundedScrollRestore(container, targetTop, {
      onSettled: () => {
        isRestoringRef.current = false;
      },
    });

    return () => {
      cancelRestore();
      isRestoringRef.current = false;
    };
  }, [containerRef, locationKey, location.pathname, location.hash, navigationType, disabled, store]);
}
