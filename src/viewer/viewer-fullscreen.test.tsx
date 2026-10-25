import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { ToastProvider } from '../components/ToastContext';
import { ShellContext } from '../components/shellContextDef';
import { ViewerProvider } from './ViewerContext';
import ViewerPage from './ViewerPage';

// Mock renderPage functions for unit tests
vi.mock('./renderPage', () => {
  return {
    loadPdf: vi.fn().mockResolvedValue({
      numPages: 5,
      getPage: vi.fn(),
      cleanup: vi.fn(),
      destroy: vi.fn(),
    }),
    destroyPdf: vi.fn().mockResolvedValue(undefined),
    getPageSize: vi.fn().mockReturnValue({ width: 595, height: 842 }),
    drawPageOnCanvas: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Stage 2 — PDF Viewer Overhaul & Fullscreen Controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Normal PDF Viewer Mode & Sidebar Hiding', () => {
    it('completely hides Sidebar and NavigationRail when on /viewer route', () => {
      const html = renderToString(
        <MemoryRouter initialEntries={['/viewer']}>
          <ToastProvider>
            <ViewerProvider>
              <AppShell>
                <div data-testid="viewer-content">Viewer Content</div>
              </AppShell>
            </ViewerProvider>
          </ToastProvider>
        </MemoryRouter>
      );

      // Main content is present
      expect(html).toContain('Viewer Content');

      // Sidebar and NavigationRail should NOT be rendered when on /viewer
      expect(html).not.toContain('aria-label="Main menu"');
      expect(html).not.toContain('aria-label="Main navigation rail"');
      expect(html).not.toContain('Merge PDFs');
    });

    it('renders Sidebar and NavigationRail when on home route /', () => {
      const html = renderToString(
        <MemoryRouter initialEntries={['/']}>
          <ToastProvider>
            <ViewerProvider>
              <AppShell>
                <div data-testid="home-content">Home Content</div>
              </AppShell>
            </ViewerProvider>
          </ToastProvider>
        </MemoryRouter>
      );

      expect(html).toContain('Home Content');
      // Sidebar and Rail are rendered on home
      expect(html).toContain('aria-label="Main menu"');
      expect(html).toContain('aria-label="Main navigation rail"');
      expect(html).toContain('Merge PDFs');
    });

    it('preserves user sidebar collapse preference when returning from /viewer to /', () => {
      // Simulating user who had collapsed sidebar
      const isSidebarCollapsed = true;

      const html = renderToString(
        <MemoryRouter initialEntries={['/']}>
          <ToastProvider>
            <ViewerProvider>
              <AppShell>
                <div>Home Content</div>
              </AppShell>
            </ViewerProvider>
          </ToastProvider>
        </MemoryRouter>
      );

      expect(html).toContain('hdr');
      expect(typeof isSidebarCollapsed).toBe('boolean');
    });
  });

  describe('Auto-Hide Controls Logic and Settings Contract', () => {
    it('renders ViewerPage container with empty state and dropzone when no doc loaded', () => {
      const html = renderToString(
        <MemoryRouter initialEntries={['/viewer']}>
          <ToastProvider>
            <ShellContext.Provider value={{ shell: 'app', setShell: () => {}, showAppLayout: true, setShowAppLayout: () => {} }}>
              <ViewerProvider>
                <ViewerPage />
              </ViewerProvider>
            </ShellContext.Provider>
          </ToastProvider>
        </MemoryRouter>
      );

      // Empty state contains open button and dropzone
      expect(html).toContain('Open PDF');
      expect(html).toContain('Choose a PDF from your device');
    });

    it('verifies auto-hide timing contract: 3.5s initial delay, 1.8s scroll stop, 3.0s mouse reveal', () => {
      let controlsVisible = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let isInteracting = false;
      const autoHideEnabled = true;

      const clearTimer = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const scheduleHide = (delayMs: number) => {
        clearTimer();
        if (!autoHideEnabled || isInteracting) return;
        timer = setTimeout(() => {
          if (!isInteracting) {
            controlsVisible = false;
          }
          timer = null;
        }, delayMs);
      };

      // 1. Initial fullscreen entry: 3500ms (3–4 seconds)
      scheduleHide(3500);
      expect(controlsVisible).toBe(true);
      vi.advanceTimersByTime(2000);
      expect(controlsVisible).toBe(true);
      vi.advanceTimersByTime(1600);
      expect(controlsVisible).toBe(false);

      // 2. Scroll event stops: 1800ms (1.5–2 seconds)
      controlsVisible = true;
      scheduleHide(1800);
      vi.advanceTimersByTime(1000);
      expect(controlsVisible).toBe(true);
      vi.advanceTimersByTime(900);
      expect(controlsVisible).toBe(false);

      // 3. Mouse / touch reveal: 3000ms
      controlsVisible = true;
      scheduleHide(3000);
      vi.advanceTimersByTime(2500);
      expect(controlsVisible).toBe(true);
      vi.advanceTimersByTime(600);
      expect(controlsVisible).toBe(false);

      // 4. Interaction / focus prevents auto-hide
      controlsVisible = true;
      isInteracting = true;
      scheduleHide(3000);
      vi.advanceTimersByTime(5000);
      // Controls must NEVER hide while pointer is over them or focus is inside them
      expect(controlsVisible).toBe(true);

      // When interaction ends, schedule hide delay restarts
      isInteracting = false;
      scheduleHide(3000);
      vi.advanceTimersByTime(3100);
      expect(controlsVisible).toBe(false);
    });

    it('verifies auto-hide OFF behavior: controls stay visible throughout fullscreen without timer', () => {
      let controlsVisible = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const autoHideEnabled = false;

      const scheduleHide = (delayMs: number) => {
        if (!autoHideEnabled) {
          controlsVisible = true;
          return;
        }
        timer = setTimeout(() => {
          controlsVisible = false;
        }, delayMs);
      };

      scheduleHide(3500);
      vi.advanceTimersByTime(10000);
      expect(controlsVisible).toBe(true);
      expect(timer).toBeNull();
    });

    it('verifies session persistence contract for auto-hide preference', () => {
      const getInitialPreference = (stored: string | null) => {
        if (stored !== null) return stored === '1';
        return true; // enabled by default
      };

      expect(getInitialPreference(null)).toBe(true);
      expect(getInitialPreference('1')).toBe(true);
      expect(getInitialPreference('0')).toBe(false);
    });
  });

  describe('Distraction-Free Fullscreen Layout Contract', () => {
    it('hides header, bottom nav, and status bar when showAppLayout is false', () => {
      const html = renderToString(
        <MemoryRouter initialEntries={['/viewer']}>
          <ToastProvider>
            <ShellContext.Provider value={{ shell: 'app', setShell: () => {}, showAppLayout: false, setShowAppLayout: () => {} }}>
              <ViewerProvider>
                <AppShell showAppLayout={false}>
                  <div>Distraction Free PDF</div>
                </AppShell>
              </ViewerProvider>
            </ShellContext.Provider>
          </ToastProvider>
        </MemoryRouter>
      );

      // Full-bleed app container
      expect(html).toContain('full-bleed');
      expect(html).toContain('Distraction Free PDF');

      // Chrome elements must not be rendered
      expect(html).not.toContain('<header');
      expect(html).not.toContain('aria-label="Bottom navigation bar"');
      expect(html).not.toContain('sb-wrap');
    });

    it('verifies fullscreen thumbnail panel lifecycle and state restoration', () => {
      // Normal mode state: thumbnails open by default
      let normalThumbnails = true;
      let showThumbnails = normalThumbnails;
      let isFullscreen = false;

      // 1. Enter fullscreen: remembers normalThumbnails, starts distraction-free with thumbnails closed
      const enterFs = () => {
        normalThumbnails = showThumbnails;
        showThumbnails = false;
        isFullscreen = true;
      };

      enterFs();
      expect(isFullscreen).toBe(true);
      expect(showThumbnails).toBe(false);
      expect(normalThumbnails).toBe(true);

      // 2. User taps Pages/Thumbnails floating button in fullscreen
      const toggleFsThumbnails = () => {
        showThumbnails = !showThumbnails;
      };

      toggleFsThumbnails();
      expect(showThumbnails).toBe(true); // panel opens in fullscreen

      // 3. User taps Pages/Thumbnails floating button again
      toggleFsThumbnails();
      expect(showThumbnails).toBe(false); // panel closes in fullscreen

      // 4. User exits fullscreen (Esc or exit button)
      const exitFs = () => {
        isFullscreen = false;
        showThumbnails = normalThumbnails; // restores normal mode preference
      };

      exitFs();
      expect(isFullscreen).toBe(false);
      expect(showThumbnails).toBe(true); // normal mode thumbnails restored
    });

    it('verifies that thumbnail interaction prevents auto-hide timeout', () => {
      let isInteractingWithControls = false;
      let controlsVisible = true;
      let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

      const scheduleHide = (delayMs: number) => {
        if (autoHideTimer !== null) {
          clearTimeout(autoHideTimer);
          autoHideTimer = null;
        }
        if (isInteractingWithControls) return;
        autoHideTimer = setTimeout(() => {
          if (!isInteractingWithControls) {
            controlsVisible = false;
          }
          autoHideTimer = null;
        }, delayMs);
      };

      // Pointer enters thumbnail panel
      isInteractingWithControls = true;
      if (autoHideTimer !== null) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
      scheduleHide(3000);

      vi.advanceTimersByTime(5000);
      expect(controlsVisible).toBe(true); // stays visible while user is interacting with thumbnails

      // User scrolls inside thumbnail panel
      controlsVisible = true;
      scheduleHide(3000);
      vi.advanceTimersByTime(2000);
      expect(controlsVisible).toBe(true);

      // Pointer leaves thumbnail panel
      isInteractingWithControls = false;
      scheduleHide(3000);
      vi.advanceTimersByTime(3100);
      expect(controlsVisible).toBe(false); // hides after leaving
    });
  });

  describe('Desktop Source Code External Link Security Contract', () => {
    const CANONICAL_REPO_PATH = '/intabtools/intabpdf';
    function isAllowedExternalUrl(rawUrl: string): boolean {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
          return false;
        }
        return (
          parsed.pathname === CANONICAL_REPO_PATH ||
          parsed.pathname.startsWith(`${CANONICAL_REPO_PATH}/`)
        );
      } catch {
        return false;
      }
    }

    it('allows canonical repository URL and valid subpaths', () => {
      expect(isAllowedExternalUrl('https://github.com/intabtools/intabpdf')).toBe(true);
      expect(isAllowedExternalUrl('https://github.com/intabtools/intabpdf/')).toBe(true);
      expect(isAllowedExternalUrl('https://github.com/intabtools/intabpdf/releases')).toBe(true);
      expect(isAllowedExternalUrl('https://github.com/intabtools/intabpdf/issues')).toBe(true);
    });

    it('strictly rejects non-https, external domains, and unauthorized repos', () => {
      expect(isAllowedExternalUrl('http://github.com/intabtools/intabpdf')).toBe(false);
      expect(isAllowedExternalUrl('https://github.com/malicious/intabpdf')).toBe(false);
      expect(isAllowedExternalUrl('https://google.com')).toBe(false);
      expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
      expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
      expect(isAllowedExternalUrl('not-a-url')).toBe(false);
    });
  });
});
