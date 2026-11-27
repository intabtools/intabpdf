// Contextual text selection menu for the PDF viewer (Copy, Select All on Page, Share, Search Web).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Globe, Share2, TextSelect } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { getPlatformType, openExternalUrl } from '../platform';
import { copyTextToClipboard } from '../platform/clipboard';
import { shareSelectedText } from '../platform/share';
import { selectAllTextOnPage } from './pageTextSelection';
import {
  SELECTION_RESTORED_EVENT,
  cancelPendingTextSelectionRestore,
  isRestoringTextSelection,
} from './renderPage';
import {
  clampSelectionMenuLeft,
  computeSelectionMenuPosition,
  type SelectionOrigin,
} from './selectionMenuPosition';

export interface SelectionState {
  text: string;
  top: number;
  left: number;
  anchorCenterX: number;
  origin: SelectionOrigin;
  visible: boolean;
}

interface ViewerSelectionMenuProps {
  containerRef: React.RefObject<HTMLElement | null>;
  currentPage: number;
  allowCopying?: boolean;
  onSelectAllPage?: () => void;
  selectAllSignal?: number;
  isFullscreen?: boolean;
  initialSelection?: (Omit<SelectionState, 'anchorCenterX' | 'origin'> & {
    anchorCenterX?: number;
    origin?: SelectionOrigin;
  }) | null;
}

export default function ViewerSelectionMenu({
  containerRef,
  currentPage,
  allowCopying = true,
  onSelectAllPage,
  selectAllSignal = 0,
  isFullscreen = false,
  initialSelection = null,
}: ViewerSelectionMenuProps): ReactNode {
  const [selectionState, setSelectionState] = useState<SelectionState | null>(() =>
    initialSelection
      ? {
          ...initialSelection,
          anchorCenterX: initialSelection.anchorCenterX ?? initialSelection.left,
          origin: initialSelection.origin ?? 'range',
        }
      : null,
  );
  const { showToast } = useToast();
  const menuRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<SelectionOrigin>(initialSelection?.origin ?? 'range');
  const prevSignalRef = useRef<number>(selectAllSignal);
  const isAndroid = getPlatformType() === 'android';

  const updateSelection = useCallback(() => {
    // Android uses WebView's single native floating ActionMode menu instead of a second React toolbar
    if (isAndroid || !allowCopying) {
      setSelectionState(null);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      if (!isRestoringTextSelection()) {
        originRef.current = 'range';
      }
      setSelectionState(null);
      return;
    }

    // Preserve exact line breaks and meaningful whitespace while rejecting pure-whitespace selections
    const rawText = selection.toString();
    if (!rawText || rawText.trim().length === 0) {
      if (!isRestoringTextSelection()) {
        originRef.current = 'range';
      }
      setSelectionState(null);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      setSelectionState(null);
      return;
    }

    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if (
      (!anchor || !container.contains(anchor)) &&
      (!focus || !container.contains(focus))
    ) {
      setSelectionState(null);
      return;
    }

    try {
      const range = selection.getRangeAt(0);
      const boundingRect = range.getBoundingClientRect();
      if (boundingRect.width === 0 && boundingRect.height === 0) {
        setSelectionState(null);
        return;
      }

      const cvsEl = container.querySelector('.cvs');
      const cvsRect = cvsEl ? cvsEl.getBoundingClientRect() : container.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth || Math.min(390, Math.max(160, window.innerWidth - 24));
      const menuHeight = menuRef.current?.offsetHeight || 40;
      const clientRects = Array.from(range.getClientRects());

      const pos = computeSelectionMenuPosition({
        origin: originRef.current,
        clientRects,
        boundingRect,
        containerViewportRect: {
          top: cvsRect.top,
          bottom: cvsRect.bottom,
          left: cvsRect.left,
          right: cvsRect.right,
          width: cvsRect.width,
        },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        menuWidth,
        menuHeight,
        isFullscreen,
      });

      setSelectionState({
        text: rawText,
        top: pos.top,
        left: pos.left,
        anchorCenterX: pos.anchorCenterX,
        origin: originRef.current,
        visible: true,
      });
    } catch {
      setSelectionState(null);
    }
  }, [allowCopying, isAndroid, containerRef, isFullscreen]);

  // Mark selection origin as select-all when triggered via Ctrl+A or context menu
  useEffect(() => {
    if (isAndroid) return;
    if (selectAllSignal !== prevSignalRef.current) {
      prevSignalRef.current = selectAllSignal;
      if (selectAllSignal > 0) {
        originRef.current = 'select-all';
        const timer = setTimeout(updateSelection, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [isAndroid, selectAllSignal, updateSelection]);

  useEffect(() => {
    if (isAndroid || !allowCopying) {
      return;
    }

    const handleContainerPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      if (target?.closest('.textLayer')) {
        cancelPendingTextSelectionRestore();
        originRef.current = 'range';
      }
    };

    const handleMouseUp = () => {
      setTimeout(updateSelection, 10);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelPendingTextSelectionRestore();
        originRef.current = 'range';
        window.getSelection()?.removeAllRanges();
        setSelectionState(null);
        return;
      }
      if (e.shiftKey && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) {
        cancelPendingTextSelectionRestore();
        originRef.current = 'range';
      }
      setTimeout(updateSelection, 10);
    };

    const handleScrollOrResize = () => {
      if (window.getSelection()?.toString().trim()) {
        updateSelection();
      } else {
        if (!isRestoringTextSelection()) {
          originRef.current = 'range';
        }
        setSelectionState(null);
      }
    };

    document.addEventListener('selectionchange', updateSelection);
    document.addEventListener('pointerdown', handleContainerPointerDown, true);
    window.addEventListener(SELECTION_RESTORED_EVENT, updateSelection);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('selectionchange', updateSelection);
      document.removeEventListener('pointerdown', handleContainerPointerDown, true);
      window.removeEventListener(SELECTION_RESTORED_EVENT, updateSelection);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isAndroid, allowCopying, updateSelection]);

  // Measure actual rendered menu width after mount so wide labels never overflow viewport bounds
  useLayoutEffect(() => {
    if (!allowCopying || !selectionState?.visible || isAndroid || !menuRef.current) return;
    const measuredWidth = menuRef.current.offsetWidth;
    if (measuredWidth <= 0) return;
    const clampedLeft = clampSelectionMenuLeft(
      selectionState.anchorCenterX,
      measuredWidth,
      window.innerWidth,
    );
    if (Math.abs(clampedLeft - selectionState.left) > 1) {
      setSelectionState((prev) => (prev ? { ...prev, left: clampedLeft } : prev));
    }
  }, [allowCopying, isAndroid, selectionState]);

  if (isAndroid || !allowCopying || !selectionState || !selectionState.visible) {
    return null;
  }

  const handleCopy = async () => {
    if (!allowCopying) {
      showToast('Copying text is restricted by this PDF\'s permissions');
      return;
    }
    const copied = await copyTextToClipboard(selectionState.text);
    showToast(copied ? 'Copied to clipboard' : 'Failed to copy');
  };

  const handleSelectAll = () => {
    if (!allowCopying) {
      showToast('Copying text is restricted by this PDF\'s permissions');
      return;
    }
    if (onSelectAllPage) {
      originRef.current = 'select-all';
      onSelectAllPage();
      return;
    }
    if (selectAllTextOnPage(currentPage, containerRef.current)) {
      originRef.current = 'select-all';
      updateSelection();
    }
  };

  const handleShare = async () => {
    if (!allowCopying) {
      showToast('Sharing selected text is restricted by this PDF\'s permissions');
      return;
    }
    const outcome = await shareSelectedText(selectionState.text);
    if (outcome.status !== 'shared') {
      showToast(outcome.message);
    }
  };

  const handleSearchWeb = () => {
    if (!allowCopying) {
      showToast('Searching selected text is restricted by this PDF\'s permissions');
      return;
    }
    const query = encodeURIComponent(selectionState.text.trim().slice(0, 200));
    openExternalUrl(`https://www.google.com/search?q=${query}`);
  };

  return (
    <div
      ref={menuRef}
      data-selection-origin={selectionState.origin}
      className={`viewer-selection-menu${isAndroid ? ' is-android' : ''}`}
      style={
        isAndroid
          ? undefined
          : {
              top: `${selectionState.top}px`,
              left: `${selectionState.left}px`,
            }
      }
      role="toolbar"
      aria-label="Text selection actions"
      onMouseDown={(e) => {
        // Prevent clicking the toolbar buttons from collapsing the text selection
        e.preventDefault();
      }}
    >
      <button
        type="button"
        className="viewer-selection-btn"
        onClick={handleCopy}
        title="Copy text (Ctrl+C)"
        aria-label="Copy text"
      >
        <Copy size={14} />
        <span>Copy</span>
      </button>

      <button
        type="button"
        className="viewer-selection-btn"
        onClick={handleSelectAll}
        title={`Select all text on page ${currentPage} (Ctrl+A)`}
        aria-label="Select all text on current page"
      >
        <TextSelect size={14} />
        <span>Select All on Page</span>
      </button>

      <div className="viewer-selection-divider" aria-hidden="true" />

      <button
        type="button"
        className="viewer-selection-btn"
        onClick={handleShare}
        title="Share selected text"
        aria-label="Share text"
      >
        <Share2 size={14} />
        <span>Share</span>
      </button>

      <button
        type="button"
        className="viewer-selection-btn"
        onClick={handleSearchWeb}
        title="Search on Google"
        aria-label="Search web"
      >
        <Globe size={14} />
        <span>Search Web</span>
      </button>
    </div>
  );
}
