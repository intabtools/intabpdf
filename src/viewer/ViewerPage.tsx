// Screen component coordinating PDF viewer lifecycle, platform integrations, and sub-views.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useShell } from '../hooks/useShell';
import { useToast } from '../hooks/useToast';
import { sharePdfDocument } from '../platform/share';
import './viewer.css';

import ViewerToolbar from './ViewerToolbar';
import ViewerFullscreenControls from './ViewerFullscreenControls';
import ViewerSearchBar from './ViewerSearchBar';
import ViewerThumbnails from './ViewerThumbnails';
import ViewerPagesView from './ViewerPagesView';
import ViewerSelectionMenu from './ViewerSelectionMenu';
import PasswordDialog from '../components/PasswordDialog';
import { createPdfLinkService } from './pdfLinks';
import { useViewer } from '../hooks/useViewer';
import { useViewerFullscreen } from './useViewerFullscreen';
import { useViewerZoom } from './useViewerZoom';
import { useViewerSearch } from './useViewerSearch';
import { useViewerShortcuts } from './useViewerShortcuts';
import { usePdfDocumentLoader } from './usePdfDocumentLoader';
import { useViewerScrollSync } from './useViewerScrollSync';
import {
  clampSelectionToPdfTextLayers,
  isSelectionInsidePdfTextLayer,
  resolveSelectionPageNumber,
  selectAllTextNativeInPdfPage,
  selectAllTextOnPage,
} from './pageTextSelection';

export type { SearchMatch } from './types';

export default function ViewerPage(): ReactNode {
  const navigate = useNavigate();
  const { showAppLayout, setShowAppLayout } = useShell();

  const [showThumbnails, setShowThumbnails] = useState(true);
  const [mobileThumbnailsOpen, setMobileThumbnailsOpen] = useState(false);
  const [selectAllSignal, setSelectAllSignal] = useState(0);

  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const pagesWrapperRef = useRef<HTMLDivElement>(null);

  const {
    pdfDoc,
    fileName,
    pageSizes,
    allowCopying,
    currentPage,
    setCurrentPage,
    isLoading,
    setLoading,
    error,
    passwordPrompt,
    submitPassword,
    cancelPassword,
    handleOpenClick,
    handleFilesDropped,
    handleDrop,
    resetDocumentState,
  } = usePdfDocumentLoader();

  const {
    activeDocFile = null,
    zoom: savedZoom = 100,
    isFitToWidth: savedIsFitToWidth = true,
    updateReadingState,
  } = useViewer();
  const { showToast } = useToast();

  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      updateReadingState?.({ currentPage: page });
    },
    [setCurrentPage, updateReadingState]
  );

  const numPages = pdfDoc?.numPages ?? 0;

  const {
    isDistractionFree,
    isFullscreen,
    autoHideControls,
    controlsVisible,
    revealControlsTemporarily,
    toggleAutoHide,
    handleControlsPointerEnter,
    handleControlsPointerLeave,
    handleControlsFocus,
    handleControlsBlur,
    toggleDistractionFree,
    exitDistractionFree,
    exitFullscreen,
    toggleFullscreen,
    normalThumbnailsRef,
  } = useViewerFullscreen({
    shellRef,
    showAppLayout,
    setShowAppLayout,
    showThumbnails,
    setShowThumbnails,
    setMobileThumbnailsOpen,
  });

  const {
    cvsWidth,
    jumpToPage,
    handleScroll,
    isEditingPage,
    setIsEditingPage,
    pageInputValue,
    setPageInputValue,
    pageInputRef,
    handleStartPageEdit,
    handlePageJumpSubmit,
  } = useViewerScrollSync({
    pdfDoc,
    pageSizes,
    currentPage,
    setCurrentPage: handlePageChange,
    numPages,
    isFullscreen,
    showThumbnails,
    revealControlsTemporarily,
    scrollRootRef,
  });

  const linkService = useMemo(
    () => (pdfDoc ? createPdfLinkService(pdfDoc, jumpToPage) : undefined),
    [pdfDoc, jumpToPage]
  );

  useEffect(() => {
    linkService?.setCurrentPage(currentPage);
  }, [linkService, currentPage]);

  const {
    zoom,
    isFitToWidth,
    fitScale,
    effectiveScale,
    zoomIn,
    zoomOut,
    toggleFitOrZoom,
  } = useViewerZoom({
    pageSizes,
    cvsWidth,
    scrollRootRef,
    pagesWrapperRef,
    initialZoom: savedZoom,
    initialIsFitToWidth: savedIsFitToWidth,
    onZoomChange: (newZoom, newFit) => {
      updateReadingState?.({ zoom: newZoom, isFitToWidth: newFit });
    },
  });

  const {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    matches,
    currentMatchIndex,
    isSearching,
    setIsSearching,
    searchInputRef,
    goToNextMatch,
    goToPrevMatch,
    handleToggleSearch,
    handleSearchInputKeyDown,
  } = useViewerSearch({
    pdfDoc,
    jumpToPage,
    currentPage,
  });

  const handleOpenPalette = () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
  };

  const handleCloseDocument = useCallback(async () => {
    await resetDocumentState();
    setIsSearchOpen(false);
    setSearchQuery('');
    setIsEditingPage(false);
    if (isDistractionFree) {
      exitDistractionFree();
    }
    if (isFullscreen) {
      await exitFullscreen();
    }
    navigate('/');
  }, [
    resetDocumentState,
    isDistractionFree,
    exitDistractionFree,
    isFullscreen,
    exitFullscreen,
    navigate,
    setIsSearchOpen,
    setSearchQuery,
    setIsEditingPage,
  ]);

  const selectCurrentPageText = useCallback(() => {
    if (!allowCopying) {
      showToast('Copying text is restricted by this PDF\'s permissions.');
      return;
    }
    const targetPage = resolveSelectionPageNumber(shellRef.current) ?? currentPage;
    const selected = selectAllTextOnPage(targetPage, shellRef.current);
    if (!selected) {
      showToast(`Page ${targetPage} text is still loading…`);
      return;
    }

    setSelectAllSignal((prev) => prev + 1);

    if (numPages > 1) {
      showToast(`Selected text on page ${targetPage} of ${numPages}`);
    }
  }, [allowCopying, currentPage, numPages, showToast]);

  const handleSharePdf = useCallback(async () => {
    const outcome = await sharePdfDocument({
      fileName: activeDocFile?.name || fileName,
      bytes: activeDocFile?.bytes,
    });
    if (outcome.status !== 'canceled' && outcome.status !== 'shared') {
      showToast(outcome.message);
    }
  }, [activeDocFile, fileName, showToast]);

  // Synchronize copy permission and Electron native Context Select All listener
  useEffect(() => {
    window.intab?.setViewerCopyAllowed?.(allowCopying);
    return () => {
      window.intab?.setViewerCopyAllowed?.(true);
    };
  }, [allowCopying]);

  useEffect(() => {
    if (!window.intab?.onContextSelectAll) return;
    return window.intab.onContextSelectAll(() => {
      selectCurrentPageText();
    });
  }, [selectCurrentPageText]);

  // Synchronize Android WebView ActionMode "Select all" bridge and clamp any escaped selection range
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const win = window as Window & {
      __intabSelectAllPdfText?: () => boolean;
      __intabHandleNativeSelectAll?: () => 'handled' | 'restricted' | 'passthrough';
      NativeIntent?: { setPdfSelectionActive?: (active: boolean) => void };
    };

    win.__intabHandleNativeSelectAll = () => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return 'passthrough';
      }
      if (!pdfDoc) {
        return 'passthrough';
      }
      if (!allowCopying) {
        showToast('Copying text is restricted by this PDF\'s permissions.');
        return 'restricted';
      }
      const targetPage = resolveSelectionPageNumber(shellRef.current) ?? currentPage;
      const selected = selectAllTextNativeInPdfPage(targetPage, shellRef.current);
      if (selected) {
        clampSelectionToPdfTextLayers(shellRef.current);
      } else {
        showToast(`Page ${targetPage} text is still loading…`);
      }
      return 'handled';
    };

    win.__intabSelectAllPdfText = () => {
      if (!pdfDoc || !allowCopying) return false;
      selectCurrentPageText();
      return true;
    };

    const syncNativeSelectionState = () => {
      clampSelectionToPdfTextLayers(shellRef.current);
      const isActive = Boolean(pdfDoc && allowCopying && isSelectionInsidePdfTextLayer(shellRef.current));
      win.NativeIntent?.setPdfSelectionActive?.(isActive);
    };

    syncNativeSelectionState();
    document.addEventListener('selectionchange', syncNativeSelectionState);
    return () => {
      document.removeEventListener('selectionchange', syncNativeSelectionState);
      win.NativeIntent?.setPdfSelectionActive?.(false);
      delete win.__intabSelectAllPdfText;
      delete win.__intabHandleNativeSelectAll;
    };
  }, [pdfDoc, allowCopying, currentPage, selectCurrentPageText, showToast]);

  useViewerShortcuts({
    isSearchOpen,
    setIsSearchOpen,
    searchInputRef,
    mobileThumbnailsOpen,
    setMobileThumbnailsOpen,
    isFullscreen,
    exitFullscreen,
    toggleFullscreen,
    isDistractionFree,
    exitDistractionFree,
    jumpToPage,
    currentPage,
    numPages,
    zoomIn,
    zoomOut,
    toggleFitOrZoom,
    onSelectAllPage: selectCurrentPageText,
  });

  const handleShellCopyOrCut = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!allowCopying) {
        event.preventDefault();
        showToast('Copying text is restricted by this PDF\'s permissions.');
      }
    },
    [allowCopying, showToast],
  );

  const handleReturnHome = useCallback(async () => {
    await resetDocumentState();
    navigate('/');
  }, [resetDocumentState, navigate]);

  return (
    <div
      ref={shellRef}
      className={`viewer-shell ${isFullscreen ? 'is-fullscreen' : ''} ${showThumbnails ? 'thm-open' : ''}`}
      onCopy={handleShellCopyOrCut}
      onCut={handleShellCopyOrCut}
      onMouseMove={() => {
        if (isFullscreen) {
          revealControlsTemporarily(3000);
        }
      }}
      onTouchStart={() => {
        if (isFullscreen) {
          revealControlsTemporarily(3000);
        }
      }}
      onClick={() => {
        if (isFullscreen && !controlsVisible) {
          revealControlsTemporarily(3500);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void handleDrop(e)}
    >
      {!isFullscreen && (
        <ViewerToolbar
          pdfDoc={pdfDoc}
          isLoading={isLoading}
          onOpenClick={() => void handleOpenClick()}
          onOpenPalette={handleOpenPalette}
          onCloseDocument={() => void handleCloseDocument()}
          showThumbnails={showThumbnails}
          mobileThumbnailsOpen={mobileThumbnailsOpen}
          onToggleThumbnails={() => {
            if (typeof window !== 'undefined' && window.innerWidth < 520) {
              setMobileThumbnailsOpen((prev) => !prev);
            } else {
              setShowThumbnails((prev) => {
                const next = !prev;
                if (!isFullscreen) {
                  normalThumbnailsRef.current = next;
                }
                return next;
              });
            }
          }}
          currentPage={currentPage}
          numPages={numPages}
          onJumpToPage={jumpToPage}
          isEditingPage={isEditingPage}
          setIsEditingPage={setIsEditingPage}
          pageInputRef={pageInputRef}
          pageInputValue={pageInputValue}
          setPageInputValue={setPageInputValue}
          onPageJumpSubmit={handlePageJumpSubmit}
          onStartPageEdit={handleStartPageEdit}
          zoom={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          isFitToWidth={isFitToWidth}
          fitScale={fitScale}
          onToggleFitOrZoom={toggleFitOrZoom}
          isSearchOpen={isSearchOpen}
          onToggleSearch={handleToggleSearch}
          onSharePdf={pdfDoc ? () => void handleSharePdf() : undefined}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => void toggleFullscreen()}
          autoHideControls={autoHideControls}
          onToggleAutoHide={toggleAutoHide}
          isDistractionFree={isDistractionFree}
          onToggleDistractionFree={toggleDistractionFree}
        />
      )}

      {pdfDoc && isFullscreen && (
        <ViewerFullscreenControls
          controlsVisible={controlsVisible}
          onPointerEnter={handleControlsPointerEnter}
          onPointerLeave={handleControlsPointerLeave}
          onFocus={handleControlsFocus}
          onBlur={handleControlsBlur}
          onExitFullscreen={() => void exitFullscreen()}
          isSearchOpen={isSearchOpen}
          onToggleSearch={handleToggleSearch}
          showThumbnails={showThumbnails}
          mobileThumbnailsOpen={mobileThumbnailsOpen}
          setShowThumbnails={setShowThumbnails}
          setMobileThumbnailsOpen={setMobileThumbnailsOpen}
          currentPage={currentPage}
          numPages={numPages}
          onJumpToPage={jumpToPage}
          isEditingPage={isEditingPage}
          setIsEditingPage={setIsEditingPage}
          pageInputRef={pageInputRef}
          pageInputValue={pageInputValue}
          setPageInputValue={setPageInputValue}
          onPageJumpSubmit={handlePageJumpSubmit}
          onStartPageEdit={handleStartPageEdit}
          zoom={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          isFitToWidth={isFitToWidth}
          fitScale={fitScale}
          onToggleFitOrZoom={toggleFitOrZoom}
        />
      )}

      {pdfDoc && !error && !allowCopying && (
        <div className="viewer-permission-banner" role="status" aria-live="polite">
          <ShieldAlert size={14} aria-hidden="true" />
          <span>Copying text is disabled by this PDF&apos;s permissions. Reading, search, and navigation remain available.</span>
        </div>
      )}

      {isSearchOpen && pdfDoc && (
        <ViewerSearchBar
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isSearching={isSearching}
          setIsSearching={setIsSearching}
          matches={matches}
          currentMatchIndex={currentMatchIndex}
          onKeyDown={handleSearchInputKeyDown}
          onPrevMatch={goToPrevMatch}
          onNextMatch={goToNextMatch}
          onClose={() => setIsSearchOpen(false)}
        />
      )}

      <div className="vwr">
        {pdfDoc && !error && (
          <ViewerThumbnails
            pdfDoc={pdfDoc}
            fileName={fileName}
            numPages={numPages}
            pageSizes={pageSizes}
            currentPage={currentPage}
            showThumbnails={showThumbnails}
            mobileThumbnailsOpen={mobileThumbnailsOpen}
            setMobileThumbnailsOpen={setMobileThumbnailsOpen}
            jumpToPage={jumpToPage}
            onPointerEnter={handleControlsPointerEnter}
            onPointerLeave={handleControlsPointerLeave}
            onFocus={handleControlsFocus}
            onBlur={handleControlsBlur}
            onThumbnailScroll={() => {
              if (isFullscreen) {
                revealControlsTemporarily(3000);
              }
            }}
          />
        )}

        <ViewerPagesView
          pdfDoc={pdfDoc}
          fileName={fileName}
          numPages={numPages}
          pageSizes={pageSizes}
          isLoading={isLoading}
          error={error}
          scrollRootRef={scrollRootRef}
          pagesWrapperRef={pagesWrapperRef}
          isFitToWidth={isFitToWidth}
          effectiveScale={effectiveScale}
          onScroll={handleScroll}
          onOpenClick={() => void handleOpenClick()}
          onFilesDroppedStart={() => setLoading(true)}
          onFilesDropped={handleFilesDropped}
          onReturnHome={() => void handleReturnHome()}
          onDoubleClickPage={toggleFitOrZoom}
          searchQuery={searchQuery}
          matches={matches}
          currentMatchIndex={currentMatchIndex}
          linkService={linkService}
          allowCopying={allowCopying}
        />
      </div>

      <ViewerSelectionMenu
        containerRef={shellRef}
        currentPage={currentPage}
        allowCopying={allowCopying}
        onSelectAllPage={selectCurrentPageText}
        selectAllSignal={selectAllSignal}
        isFullscreen={isFullscreen}
      />

      {passwordPrompt && (
        <PasswordDialog
          fileName={passwordPrompt.fileName}
          isIncorrect={passwordPrompt.isIncorrect}
          isSubmitting={passwordPrompt.isSubmitting}
          onSubmit={submitPassword}
          onCancel={cancelPassword}
        />
      )}
    </div>
  );
}
