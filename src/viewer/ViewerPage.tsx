// Screen component coordinating PDF viewer lifecycle, platform integrations, and sub-views.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShell } from '../hooks/useShell';
import './viewer.css';

import ViewerToolbar from './ViewerToolbar';
import ViewerFullscreenControls from './ViewerFullscreenControls';
import ViewerSearchBar from './ViewerSearchBar';
import ViewerThumbnails from './ViewerThumbnails';
import ViewerPagesView from './ViewerPagesView';
import PasswordDialog from '../components/PasswordDialog';
import { createPdfLinkService } from './pdfLinks';
import { useViewer } from '../hooks/useViewer';
import { useViewerFullscreen } from './useViewerFullscreen';
import { useViewerZoom } from './useViewerZoom';
import { useViewerSearch } from './useViewerSearch';
import { useViewerShortcuts } from './useViewerShortcuts';
import { usePdfDocumentLoader } from './usePdfDocumentLoader';
import { useViewerScrollSync } from './useViewerScrollSync';

export type { SearchMatch } from './types';

export default function ViewerPage(): ReactNode {
  const navigate = useNavigate();
  const { showAppLayout, setShowAppLayout } = useShell();

  const [showThumbnails, setShowThumbnails] = useState(true);
  const [mobileThumbnailsOpen, setMobileThumbnailsOpen] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const pagesWrapperRef = useRef<HTMLDivElement>(null);

  const {
    pdfDoc,
    fileName,
    pageSizes,
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
    zoom: savedZoom = 100,
    isFitToWidth: savedIsFitToWidth = true,
    updateReadingState,
  } = useViewer();

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
  });

  const handleReturnHome = useCallback(async () => {
    await resetDocumentState();
    navigate('/');
  }, [resetDocumentState, navigate]);

  return (
    <div
      ref={shellRef}
      className={`viewer-shell ${isFullscreen ? 'is-fullscreen' : ''} ${showThumbnails ? 'thm-open' : ''}`}
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
        />
      </div>

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
