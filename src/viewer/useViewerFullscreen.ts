// Custom hook managing fullscreen mode, distraction-free reading, and auto-hiding controls.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import type { UseViewerFullscreenOptions, UseViewerFullscreenResult } from './types';

export type { UseViewerFullscreenOptions, UseViewerFullscreenResult };

export function useViewerFullscreen({
  shellRef,
  showAppLayout,
  setShowAppLayout,
  showThumbnails,
  setShowThumbnails,
  setMobileThumbnailsOpen,
}: UseViewerFullscreenOptions): UseViewerFullscreenResult {
  const [isDistractionFree, setIsDistractionFree] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoHideControls, setAutoHideControls] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem('intab.viewer.autohide');
      if (saved !== null) return saved === '1';
    } catch {
      // Session storage unavailable
    }
    return true;
  });
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);

  const autoHideTimerRef = useRef<number | null>(null);
  const isInteractingWithControlsRef = useRef<boolean>(false);
  const hadNativeFullscreenRef = useRef<boolean>(false);
  const normalThumbnailsRef = useRef<boolean>(true);

  const clearAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current !== null) {
      window.clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }, []);

  const scheduleAutoHide = useCallback(
    (delayMs: number) => {
      clearAutoHideTimer();
      if (!autoHideControls) {
        setControlsVisible(true);
        return;
      }
      if (isInteractingWithControlsRef.current) {
        return;
      }
      autoHideTimerRef.current = window.setTimeout(() => {
        if (!isInteractingWithControlsRef.current) {
          setControlsVisible(false);
        }
        autoHideTimerRef.current = null;
      }, delayMs);
    },
    [autoHideControls, clearAutoHideTimer]
  );

  const revealControlsTemporarily = useCallback(
    (delayMs = 3000) => {
      setControlsVisible(true);
      scheduleAutoHide(delayMs);
    },
    [scheduleAutoHide]
  );

  const toggleAutoHide = useCallback(() => {
    setAutoHideControls((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem('intab.viewer.autohide', next ? '1' : '0');
      } catch {
        // ignore
      }
      if (next) {
        scheduleAutoHide(3500);
      } else {
        clearAutoHideTimer();
        setControlsVisible(true);
      }
      return next;
    });
  }, [clearAutoHideTimer, scheduleAutoHide]);

  const handleControlsPointerEnter = useCallback(() => {
    isInteractingWithControlsRef.current = true;
    clearAutoHideTimer();
    setControlsVisible(true);
  }, [clearAutoHideTimer]);

  const handleControlsPointerLeave = useCallback(() => {
    isInteractingWithControlsRef.current = false;
    if (isFullscreen && autoHideControls) {
      scheduleAutoHide(3000);
    }
  }, [isFullscreen, autoHideControls, scheduleAutoHide]);

  const handleControlsFocus = useCallback(() => {
    isInteractingWithControlsRef.current = true;
    clearAutoHideTimer();
    setControlsVisible(true);
  }, [clearAutoHideTimer]);

  const handleControlsBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        isInteractingWithControlsRef.current = false;
        if (isFullscreen && autoHideControls) {
          scheduleAutoHide(3000);
        }
      }
    },
    [isFullscreen, autoHideControls, scheduleAutoHide]
  );

  // Keep distraction-free mode synchronized if AppShell restores layout (e.g. via Escape or Android Back)
  useEffect(() => {
    if (showAppLayout && isDistractionFree) {
      const timer = setTimeout(() => {
        setIsDistractionFree(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [showAppLayout, isDistractionFree]);

  const enterDistractionFree = useCallback(() => {
    setIsDistractionFree(true);
    setShowAppLayout(false);
  }, [setShowAppLayout]);

  const exitDistractionFree = useCallback(() => {
    setIsDistractionFree(false);
    setShowAppLayout(true);
  }, [setShowAppLayout]);

  const toggleDistractionFree = useCallback(() => {
    if (isDistractionFree) {
      exitDistractionFree();
    } else {
      enterDistractionFree();
    }
  }, [enterDistractionFree, exitDistractionFree, isDistractionFree]);

  const enterFullscreen = useCallback(async () => {
    normalThumbnailsRef.current = showThumbnails;
    setShowThumbnails(false);
    setMobileThumbnailsOpen(false);
    setShowAppLayout(false);
    setIsFullscreen(true);
    setIsDistractionFree(false);
    setControlsVisible(true);
    isInteractingWithControlsRef.current = false;
    scheduleAutoHide(3500);

    const targetEl = shellRef.current || document.documentElement;
    if (targetEl && targetEl.requestFullscreen && !document.fullscreenElement) {
      try {
        await targetEl.requestFullscreen();
        hadNativeFullscreenRef.current = true;
      } catch {
        hadNativeFullscreenRef.current = false;
      }
    }
  }, [
    scheduleAutoHide,
    setMobileThumbnailsOpen,
    setShowAppLayout,
    setShowThumbnails,
    shellRef,
    showThumbnails,
  ]);

  const exitFullscreen = useCallback(async () => {
    clearAutoHideTimer();
    setControlsVisible(true);
    isInteractingWithControlsRef.current = false;
    setIsFullscreen(false);
    setShowAppLayout(true);
    setShowThumbnails(normalThumbnailsRef.current);
    setMobileThumbnailsOpen(false);

    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignored
      }
    }
    hadNativeFullscreenRef.current = false;
  }, [clearAutoHideTimer, setMobileThumbnailsOpen, setShowAppLayout, setShowThumbnails]);

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, isFullscreen]);

  // Adjust fullscreen state when showAppLayout changes externally
  useEffect(() => {
    if (showAppLayout && isFullscreen) {
      const timer = window.setTimeout(() => {
        setIsFullscreen(false);
        clearAutoHideTimer();
        setControlsVisible(true);
        isInteractingWithControlsRef.current = false;
        setShowThumbnails(normalThumbnailsRef.current);
        setMobileThumbnailsOpen(false);
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [showAppLayout, isFullscreen, clearAutoHideTimer, setShowThumbnails, setMobileThumbnailsOpen]);

  // Native fullscreenchange event handling (e.g. user pressed Esc to exit native browser fullscreen)
  useEffect(() => {
    const onFullscreenChange = () => {
      const isNativeFs = Boolean(document.fullscreenElement);
      if (!isNativeFs && isFullscreen && hadNativeFullscreenRef.current) {
        hadNativeFullscreenRef.current = false;
        setIsFullscreen(false);
        setShowAppLayout(true);
        clearAutoHideTimer();
        setControlsVisible(true);
        isInteractingWithControlsRef.current = false;
        setShowThumbnails(normalThumbnailsRef.current);
        setMobileThumbnailsOpen(false);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [
    isFullscreen,
    setShowAppLayout,
    clearAutoHideTimer,
    setShowThumbnails,
    setMobileThumbnailsOpen,
  ]);

  useEffect(() => {
    return () => {
      clearAutoHideTimer();
      setShowAppLayout(true);
    };
  }, [clearAutoHideTimer, setShowAppLayout]);

  return {
    isDistractionFree,
    setIsDistractionFree,
    isFullscreen,
    setIsFullscreen,
    autoHideControls,
    setAutoHideControls,
    controlsVisible,
    setControlsVisible,
    clearAutoHideTimer,
    scheduleAutoHide,
    revealControlsTemporarily,
    toggleAutoHide,
    handleControlsPointerEnter,
    handleControlsPointerLeave,
    handleControlsFocus,
    handleControlsBlur,
    enterDistractionFree,
    exitDistractionFree,
    toggleDistractionFree,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
    normalThumbnailsRef,
  };
}
