// Contextual text selection menu for the PDF viewer (Copy, Select All, Share, Search Web).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Globe, Share2, TextSelect } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { getPlatformType, openExternalUrl } from '../platform';

export interface SelectionState {
  text: string;
  top: number;
  left: number;
  visible: boolean;
}

interface ViewerSelectionMenuProps {
  containerRef: React.RefObject<HTMLElement | null>;
  currentPage: number;
  initialSelection?: SelectionState | null;
}

export default function ViewerSelectionMenu({
  containerRef,
  currentPage,
  initialSelection = null,
}: ViewerSelectionMenuProps): ReactNode {
  const [selectionState, setSelectionState] = useState<SelectionState | null>(initialSelection);
  const { showToast } = useToast();
  const menuRef = useRef<HTMLDivElement>(null);
  const isAndroid = getPlatformType() === 'android';

  useEffect(() => {
    // Android uses the native selection experience (ActionMode menu) where compatible
    if (isAndroid) {
      return;
    }

    const updateSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setSelectionState(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setSelectionState(null);
        return;
      }

      // Ensure the selection originates inside the PDF viewer container
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
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          setSelectionState(null);
          return;
        }

        const menuHeight = 36;
        const menuWidth = Math.min(320, Math.max(160, window.innerWidth - 24));

        // Position above the selection if space permits, otherwise below
        const top =
          rect.top - menuHeight - 8 < 10
            ? rect.bottom + 8
            : rect.top - menuHeight - 8;

        const left = Math.max(
          12,
          Math.min(window.innerWidth - menuWidth - 12, rect.left + rect.width / 2 - menuWidth / 2)
        );

        setSelectionState({
          text,
          top,
          left,
          visible: true,
        });
      } catch {
        setSelectionState(null);
      }
    };

    const handleMouseUp = () => {
      // Small timeout to allow the browser to complete selection range computation
      setTimeout(updateSelection, 10);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        setSelectionState(null);
        return;
      }
      setTimeout(updateSelection, 10);
    };

    const handleScroll = () => {
      // Reposition on scroll if a selection remains active
      if (window.getSelection()?.toString().trim()) {
        updateSelection();
      } else {
        setSelectionState(null);
      }
    };

    document.addEventListener('selectionchange', updateSelection);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('selectionchange', updateSelection);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [containerRef, isAndroid]);

  if (isAndroid || !selectionState || !selectionState.visible) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectionState.text);
      showToast('Copied to clipboard');
    } catch {
      showToast('Failed to copy');
    }
  };

  const handleSelectAll = () => {
    const activeTextLayer =
      document.querySelector(`.pg-item[data-page="${currentPage}"] .textLayer`) ||
      containerRef.current?.querySelector('.textLayer');

    if (activeTextLayer) {
      const range = document.createRange();
      range.selectNodeContents(activeTextLayer);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text: selectionState.text });
      } catch {
        // User cancelled or share unhandled
      }
    } else {
      try {
        await navigator.clipboard.writeText(selectionState.text);
        showToast('Copied text for sharing');
      } catch {
        showToast('Share not supported');
      }
    }
  };

  const handleSearchWeb = () => {
    const query = encodeURIComponent(selectionState.text.slice(0, 200));
    openExternalUrl(`https://www.google.com/search?q=${query}`);
  };

  return (
    <div
      ref={menuRef}
      className="viewer-selection-menu"
      style={{
        top: `${selectionState.top}px`,
        left: `${selectionState.left}px`,
      }}
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
        title="Select page text"
        aria-label="Select page text"
      >
        <TextSelect size={14} />
        <span>Select All</span>
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
