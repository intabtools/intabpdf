import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface ScrollVisibilityState {
  isVisible: boolean;
  lastAnchorScrollTop: number;
}

export const INITIAL_SCROLL_VISIBILITY_STATE: ScrollVisibilityState = {
  isVisible: true,
  lastAnchorScrollTop: 0,
};

export interface ScrollVisibilityTransitionOptions {
  thresholdPx?: number;
  topRevealOffsetPx?: number;
}

export const DEFAULT_SCROLL_VISIBILITY_THRESHOLD_PX = 10;
export const DEFAULT_TOP_REVEAL_OFFSET_PX = 4;

/**
 * Pure state transition for scroll-direction-driven floating control visibility.
 *
 * Downward travel beyond `thresholdPx` hides the control; upward travel beyond
 * `thresholdPx` reveals it. Small oscillations below `thresholdPx` preserve the
 * current visibility state to prevent flickering, and stopping scroll leaves
 * visibility unchanged.
 */
export function computeScrollVisibilityTransition(
  state: ScrollVisibilityState,
  rawScrollTop: number,
  options: ScrollVisibilityTransitionOptions = {},
): ScrollVisibilityState {
  const thresholdPx = options.thresholdPx ?? DEFAULT_SCROLL_VISIBILITY_THRESHOLD_PX;
  const topRevealOffsetPx = options.topRevealOffsetPx ?? DEFAULT_TOP_REVEAL_OFFSET_PX;
  const scrollTop = Math.max(0, Number.isFinite(rawScrollTop) ? rawScrollTop : 0);

  if (scrollTop <= topRevealOffsetPx) {
    if (state.isVisible && state.lastAnchorScrollTop === scrollTop) {
      return state;
    }
    return {
      isVisible: true,
      lastAnchorScrollTop: scrollTop,
    };
  }

  const delta = scrollTop - state.lastAnchorScrollTop;
  if (delta === 0) {
    return state;
  }

  if (delta > 0) {
    if (state.isVisible) {
      if (delta >= thresholdPx) {
        return {
          isVisible: false,
          lastAnchorScrollTop: scrollTop,
        };
      }
      return state;
    }
    return {
      isVisible: false,
      lastAnchorScrollTop: scrollTop,
    };
  }

  if (!state.isVisible) {
    if (-delta >= thresholdPx) {
      return {
        isVisible: true,
        lastAnchorScrollTop: scrollTop,
      };
    }
    return state;
  }

  return {
    isVisible: true,
    lastAnchorScrollTop: scrollTop,
  };
}

export function getPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onStoreChange);
    return () => mediaQuery.removeEventListener('change', onStoreChange);
  }
  mediaQuery.addListener(onStoreChange);
  return () => mediaQuery.removeListener(onStoreChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getPrefersReducedMotion, () => false);
}

export interface UseFloatingScrollVisibilityOptions {
  scrollElementId?: string;
  thresholdPx?: number;
  topRevealOffsetPx?: number;
  disabled?: boolean;
}

/**
 * Tracks vertical scroll direction on AppShell's main scroll container and returns
 * whether a bottom floating control should remain visible.
 */
export function useFloatingScrollVisibility(options: UseFloatingScrollVisibilityOptions = {}): boolean {
  const {
    scrollElementId = 'main-content',
    thresholdPx = DEFAULT_SCROLL_VISIBILITY_THRESHOLD_PX,
    topRevealOffsetPx = DEFAULT_TOP_REVEAL_OFFSET_PX,
    disabled = false,
  } = options;

  const [isVisible, setIsVisible] = useState(true);
  const stateRef = useRef<ScrollVisibilityState>(INITIAL_SCROLL_VISIBILITY_STATE);

  useEffect(() => {
    if (disabled || typeof document === 'undefined') {
      stateRef.current = INITIAL_SCROLL_VISIBILITY_STATE;
      return;
    }

    const scrollElement = document.getElementById(scrollElementId);
    if (!scrollElement) {
      stateRef.current = INITIAL_SCROLL_VISIBILITY_STATE;
      return;
    }

    stateRef.current = {
      isVisible: true,
      lastAnchorScrollTop: Math.max(0, scrollElement.scrollTop),
    };

    const handleScroll = () => {
      const prevState = stateRef.current;
      const nextState = computeScrollVisibilityTransition(prevState, scrollElement.scrollTop, {
        thresholdPx,
        topRevealOffsetPx,
      });
      stateRef.current = nextState;
      if (nextState.isVisible !== prevState.isVisible) {
        setIsVisible(nextState.isVisible);
      }
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, [disabled, scrollElementId, thresholdPx, topRevealOffsetPx]);

  return disabled ? true : isVisible;
}
