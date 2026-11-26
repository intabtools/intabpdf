import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../pages/HomePage';
import BottomNav from './BottomNav';
import { ScanDocumentFab } from './ScanDocumentFab';
import { ShellContext } from './shellContextDef';
import { ToastProvider } from './ToastContext';
import { ViewerProvider } from '../viewer/ViewerContext';
import { isAndroidScannerSupported } from '../hooks/useScanDocument';
import {
  INITIAL_SCROLL_VISIBILITY_STATE,
  computeScrollVisibilityTransition,
  getPrefersReducedMotion,
} from '../hooks/useFloatingScrollVisibility';
import * as platformModule from '../platform';

afterEach(() => {
  vi.restoreAllMocks();
});

function renderHomeForPlatform(platform: 'web' | 'electron' | 'android'): string {
  vi.spyOn(platformModule, 'getPlatformType').mockReturnValue(platform);
  return renderToString(
    <MemoryRouter initialEntries={['/']}>
      <ShellContext.Provider
        value={{
          shell: 'app',
          setShell: () => {},
          showAppLayout: true,
          setShowAppLayout: () => {},
        }}
      >
        <ToastProvider>
          <ViewerProvider>
            <HomePage />
            <BottomNav />
          </ViewerProvider>
        </ToastProvider>
      </ShellContext.Provider>
    </MemoryRouter>,
  );
}

describe('ScanDocumentFab component and HomePage integration', () => {
  it('renders floating pill CTA and bottom nav cleanly on Android without top static scanner banner', () => {
    const html = renderHomeForPlatform('android');

    expect(html).toContain('data-testid="scan-document-fab"');
    expect(html).toContain('cnt-with-scan-fab');
    expect(html).toContain('Scan Document');
    expect(html).toContain('Open PDF files');
    // Secondary grid card in Create section remains alongside the FAB
    expect(html).toContain('Turn paper pages into a PDF');
    // Old static top banner subtitle should no longer appear on HomePage
    expect(html).not.toContain('Capture pages or import photos into a PDF</small>');
    // BottomNav remains intact
    expect(html).toContain('aria-label="Bottom navigation bar"');
  });

  it('omits floating FAB and bottom clearance class completely on Web and Electron', () => {
    for (const platform of ['web', 'electron'] as const) {
      const html = renderHomeForPlatform(platform);
      expect(html).not.toContain('data-testid="scan-document-fab"');
      expect(html).not.toContain('scan-fab-dock');
      expect(html).not.toContain('cnt-with-scan-fab');
      expect(html).not.toContain('Scan Document');

      const directFabHtml = renderToString(
        <ScanDocumentFab isScanning={false} onScan={() => {}} platform={platform} />,
      );
      expect(directFabHtml).toBe('');
    }
  });

  it('reflects visible, hidden, busy, and reduced-motion states accurately', () => {
    const visibleHtml = renderToString(
      <ScanDocumentFab
        isScanning={false}
        onScan={() => {}}
        platform="android"
        visible={true}
        reducedMotion={false}
      />,
    );
    expect(visibleHtml).toContain('class="scan-fab is-visible has-idle-motion"');
    expect(visibleHtml).toContain('data-visible="true"');
    expect(visibleHtml).toContain('data-idle-animation="true"');
    expect(visibleHtml).toContain('aria-hidden="false"');
    expect(visibleHtml).not.toContain('tabindex="-1"');

    const hiddenHtml = renderToString(
      <ScanDocumentFab
        isScanning={false}
        onScan={() => {}}
        platform="android"
        visible={false}
        reducedMotion={false}
      />,
    );
    expect(hiddenHtml).toContain('class="scan-fab is-hidden"');
    expect(hiddenHtml).toContain('data-visible="false"');
    expect(hiddenHtml).toContain('data-idle-animation="false"');
    expect(hiddenHtml).toContain('aria-hidden="true"');
    expect(hiddenHtml).toContain('tabindex="-1"');

    const reducedMotionHtml = renderToString(
      <ScanDocumentFab
        isScanning={false}
        onScan={() => {}}
        platform="android"
        visible={true}
        reducedMotion={true}
      />,
    );
    expect(reducedMotionHtml).toContain('data-reduced-motion="true"');
    expect(reducedMotionHtml).toContain('data-idle-animation="false"');
    expect(reducedMotionHtml).not.toContain('has-idle-motion');

    const busyHtml = renderToString(
      <ScanDocumentFab
        isScanning={true}
        onScan={() => {}}
        platform="android"
        visible={true}
        reducedMotion={false}
      />,
    );
    expect(busyHtml).toContain('disabled=""');
    expect(busyHtml).toContain('Opening scanner…');
    expect(busyHtml).toContain('data-idle-animation="false"');
  });

  it('gates scanner strictly by Android platform, never by app shell UI mode alone', () => {
    expect(isAndroidScannerSupported('android')).toBe(true);
    expect(isAndroidScannerSupported('web')).toBe(false);
    expect(isAndroidScannerSupported('electron')).toBe(false);

    // Default Node/browser environment (non-native Capacitor) must not report Android
    expect(platformModule.getPlatformType()).toBe('web');

    // Electron runtime detection must report 'electron', not 'android'
    vi.stubGlobal('window', { location: { search: '' }, intab: {} });
    expect(platformModule.getPlatformType()).toBe('electron');
    expect(isAndroidScannerSupported()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('detects prefers-reduced-motion from matchMedia safely', () => {
    expect(getPrefersReducedMotion()).toBe(false);

    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
    expect(getPrefersReducedMotion()).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('computeScrollVisibilityTransition', () => {
  it('hides on downward scroll past threshold and reveals on upward scroll past threshold', () => {
    let state = INITIAL_SCROLL_VISIBILITY_STATE;
    expect(state.isVisible).toBe(true);

    // Downward scroll past 10px threshold hides FAB
    state = computeScrollVisibilityTransition(state, 24);
    expect(state.isVisible).toBe(false);

    // Continued deep downward scroll keeps it hidden and tracks extrema
    state = computeScrollVisibilityTransition(state, 320);
    expect(state.isVisible).toBe(false);
    expect(state.lastAnchorScrollTop).toBe(320);

    // Reversing upward by >= 10px from current extrema reveals FAB immediately
    state = computeScrollVisibilityTransition(state, 308);
    expect(state.isVisible).toBe(true);
    expect(state.lastAnchorScrollTop).toBe(308);
  });

  it('ignores small scroll jitter below threshold to prevent flickering', () => {
    let state = INITIAL_SCROLL_VISIBILITY_STATE;

    // Small downward + upward jitter around start remains visible
    state = computeScrollVisibilityTransition(state, 6);
    expect(state.isVisible).toBe(true);
    state = computeScrollVisibilityTransition(state, 9);
    expect(state.isVisible).toBe(true);
    state = computeScrollVisibilityTransition(state, 5);
    expect(state.isVisible).toBe(true);

    // Deliberate downward scroll hides FAB
    state = computeScrollVisibilityTransition(state, 180);
    expect(state.isVisible).toBe(false);

    // Small upward jitter (< 10px) while hidden preserves hidden state
    state = computeScrollVisibilityTransition(state, 174);
    expect(state.isVisible).toBe(false);
    state = computeScrollVisibilityTransition(state, 179);
    expect(state.isVisible).toBe(false);
    state = computeScrollVisibilityTransition(state, 172);
    expect(state.isVisible).toBe(false);
  });

  it('preserves visibility state when scrolling stops and reveals cleanly at top', () => {
    // Hidden state persists when scroll position stops changing
    let state = computeScrollVisibilityTransition(INITIAL_SCROLL_VISIBILITY_STATE, 140);
    expect(state.isVisible).toBe(false);
    const stoppedHidden = computeScrollVisibilityTransition(state, 140);
    expect(stoppedHidden).toBe(state);
    expect(stoppedHidden.isVisible).toBe(false);

    // Visible state persists when scroll position stops changing
    state = computeScrollVisibilityTransition(state, 120);
    expect(state.isVisible).toBe(true);
    const stoppedVisible = computeScrollVisibilityTransition(state, 120);
    expect(stoppedVisible).toBe(state);
    expect(stoppedVisible.isVisible).toBe(true);

    // Scrolling near/to top always reveals and clamps negative rubber-band values
    state = computeScrollVisibilityTransition({ isVisible: false, lastAnchorScrollTop: 12 }, 3);
    expect(state.isVisible).toBe(true);
    state = computeScrollVisibilityTransition({ isVisible: false, lastAnchorScrollTop: 12 }, -8);
    expect(state.isVisible).toBe(true);
    expect(state.lastAnchorScrollTop).toBe(0);
  });
});
