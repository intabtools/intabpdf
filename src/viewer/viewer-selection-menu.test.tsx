import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import ViewerSelectionMenu from './ViewerSelectionMenu';
import { clampSelectionMenuLeft, computeSelectionMenuPosition } from './selectionMenuPosition';
import { selectAllTextOnPage } from './pageTextSelection';
import { resolveViewerNavigationTarget } from './viewerContextDef';
import {
  beginSelectionRestorationGuard,
  cancelPendingTextSelectionRestore,
  isRestoringTextSelection,
} from './renderPage';
import * as platformModule from '../platform';
import { ToastProvider } from '../components/ToastContext';

describe('PDF Viewer Contextual Selection Menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders Copy, Select All on Page, Share, and Search Web buttons on desktop when text is selected', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('electron');

    const containerRef = { current: null };
    const html = renderToString(
      <ToastProvider>
        <ViewerSelectionMenu
          containerRef={containerRef}
          currentPage={1}
          initialSelection={{
            text: 'InTabPDF selected text',
            top: 200,
            left: 100,
            visible: true,
          }}
        />
      </ToastProvider>
    );

    expect(html).toContain('class="viewer-selection-menu"');
    expect(html).toContain('Copy');
    expect(html).toContain('Select All on Page');
    expect(html).toContain('Share');
    expect(html).toContain('Search Web');
    expect(html).toContain('top:200px');
    expect(html).toContain('left:100px');
  });

  it('renders bottom-anchored selection actions on Android instead of suppressing the menu', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('android');

    const containerRef = { current: null };
    const html = renderToString(
      <ToastProvider>
        <ViewerSelectionMenu
          containerRef={containerRef}
          currentPage={1}
          initialSelection={{
            text: 'Android selected text',
            top: 200,
            left: 100,
            visible: true,
          }}
        />
      </ToastProvider>
    );

    expect(html).toContain('viewer-selection-menu is-android');
    expect(html).toContain('Copy');
    expect(html).toContain('Select All on Page');
    expect(html).toContain('Share');
    expect(html).toContain('Search Web');
  });

  it('hides Copy, Share, and Search Web menu when PDF copying permission is restricted', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('electron');

    const containerRef = { current: null };
    const html = renderToString(
      <ToastProvider>
        <ViewerSelectionMenu
          containerRef={containerRef}
          currentPage={1}
          allowCopying={false}
          initialSelection={{
            text: 'Restricted PDF text',
            top: 200,
            left: 100,
            visible: true,
          }}
        />
      </ToastProvider>
    );

    expect(html).toBe('');
  });

  it('clamps horizontal menu position cleanly using actual measured menu width on narrow viewports', () => {
    expect(clampSelectionMenuLeft(360, 350, 375)).toBe(13);
    expect(clampSelectionMenuLeft(20, 350, 375)).toBe(12);
    expect(clampSelectionMenuLeft(640, 350, 1280)).toBe(465);
  });

  it('anchors Select All menu stably inside visible canvas bounds instead of off-screen boundingRect top/bottom', () => {
    const pos = computeSelectionMenuPosition({
      origin: 'select-all',
      clientRects: [{ top: -321, bottom: 1263, left: 145, right: 1265, width: 1120, height: 1584 }],
      boundingRect: { top: -321, bottom: 1263, left: 145, right: 1265, width: 1120, height: 1584 },
      containerViewportRect: { top: 102, bottom: 800, left: 290, right: 1280, width: 990 },
      viewportWidth: 1280,
      viewportHeight: 800,
      menuWidth: 380,
      menuHeight: 40,
      isFullscreen: false,
    });

    expect(pos.top).toBeGreaterThanOrEqual(110);
    expect(pos.top + 40).toBeLessThanOrEqual(784);
    expect(pos.left).toBe(595); // centered in 990px canvas (290 + 495 - 190)
  });

  it('positions normal and multi-line selections near visible client rects and avoids fullscreen top pills', () => {
    // Word selection near top toolbar falls cleanly below word within canvas
    const nearTop = computeSelectionMenuPosition({
      origin: 'range',
      clientRects: [{ top: 115, bottom: 145, left: 320, right: 420, width: 100, height: 30 }],
      boundingRect: { top: 115, bottom: 145, left: 320, right: 420, width: 100, height: 30 },
      containerViewportRect: { top: 102, bottom: 800, left: 0, right: 1280, width: 1280 },
      viewportWidth: 1280,
      viewportHeight: 800,
      menuWidth: 360,
      menuHeight: 40,
    });
    expect(nearTop.top).toBe(153);

    // Multi-line selection with first line scrolled off-screen above anchors to visible line
    const multiLine = computeSelectionMenuPosition({
      origin: 'range',
      clientRects: [
        { top: -200, bottom: -170, left: 320, right: 700, width: 380, height: 30 },
        { top: 240, bottom: 270, left: 320, right: 500, width: 180, height: 30 },
      ],
      boundingRect: { top: -200, bottom: 270, left: 320, right: 700, width: 380, height: 470 },
      containerViewportRect: { top: 102, bottom: 800, left: 0, right: 1280, width: 1280 },
      viewportWidth: 1280,
      viewportHeight: 800,
      menuWidth: 360,
      menuHeight: 40,
    });
    expect(multiLine.top).toBe(192);

    // Fullscreen Select All stays clear of top fullscreen pills (>= 58px)
    const fsSelectAll = computeSelectionMenuPosition({
      origin: 'select-all',
      clientRects: [{ top: -500, bottom: 900, left: 100, right: 900, width: 800, height: 1400 }],
      boundingRect: { top: -500, bottom: 900, left: 100, right: 900, width: 800, height: 1400 },
      containerViewportRect: { top: 0, bottom: 800, left: 0, right: 1280, width: 1280 },
      viewportWidth: 1280,
      viewportHeight: 800,
      menuWidth: 380,
      menuHeight: 40,
      isFullscreen: true,
    });
    expect(fsSelectAll.top).toBeGreaterThanOrEqual(58);
  });

  it('constructs correct encoded query URL for Search Web', () => {
    const selectedText = 'privacy pdf tools';
    const query = encodeURIComponent(selectedText.slice(0, 200));
    const targetUrl = `https://www.google.com/search?q=${query}`;

    expect(targetUrl).toBe('https://www.google.com/search?q=privacy%20pdf%20tools');
  });

  it('avoids duplicate viewer history navigation across BrowserRouter and HashRouter while preserving query params', () => {
    // Already at /viewer (e.g., HashRouter #/viewer or BrowserRouter /viewer) -> do not re-push
    expect(resolveViewerNavigationTarget('/viewer', '?platform=electron', '?platform=electron')).toBeNull();
    expect(resolveViewerNavigationTarget('/viewer', '', '?platform=android')).toBeNull();

    // Navigating from Home or Tool route preserves router or window query params
    expect(resolveViewerNavigationTarget('/', '', '?platform=android')).toBe('/viewer?platform=android');
    expect(resolveViewerNavigationTarget('/tool/merge', '?platform=electron', '')).toBe('/viewer?platform=electron');
    expect(resolveViewerNavigationTarget('/', '', '')).toBe('/viewer');
  });

  it('never falls back to an adjacent page text layer in selectAllTextOnPage', () => {
    const mockPage1Layer = {
      textContent: 'Page 1 content',
      querySelector: () => ({}),
    } as unknown as HTMLElement;

    const fakeRoot = {
      querySelector: (selector: string) => {
        if (selector === '.pg-item[data-page="1"] .textLayer') return mockPage1Layer;
        if (selector === '.pg-item[data-page="5"] .textLayer') return null;
        throw new Error(`Unexpected fallback selector: ${selector}`);
      },
    } as unknown as ParentNode;

    const addRange = vi.fn();
    const removeAllRanges = vi.fn();
    vi.stubGlobal('document', {
      createRange: () => ({ selectNodeContents: vi.fn() }),
    });
    vi.stubGlobal('window', {
      getSelection: () => ({ removeAllRanges, addRange }),
    });

    expect(selectAllTextOnPage(5, fakeRoot)).toBe(false);
    expect(addRange).not.toHaveBeenCalled();

    expect(selectAllTextOnPage(1, fakeRoot)).toBe(true);
    expect(addRange).toHaveBeenCalledTimes(1);
  });

  it('tracks transient text-layer restoration guards accurately without leaking', () => {
    expect(isRestoringTextSelection()).toBe(false);
    const release = beginSelectionRestorationGuard();
    expect(isRestoringTextSelection()).toBe(true);
    release();
    release(); // Idempotent release
    expect(isRestoringTextSelection()).toBe(false);

    const release2 = beginSelectionRestorationGuard();
    expect(isRestoringTextSelection()).toBe(true);
    cancelPendingTextSelectionRestore();
    release2();
    expect(isRestoringTextSelection()).toBe(false);
  });
});
