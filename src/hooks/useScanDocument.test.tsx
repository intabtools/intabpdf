import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../pages/HomePage';
import AboutPage from '../pages/AboutPage';
import Sidebar from '../components/Sidebar';
import CommandPalette from '../components/CommandPalette';
import { ToastProvider } from '../components/ToastContext';
import { ViewerProvider } from '../viewer/ViewerContext';
import { runScanToViewerHandoff } from './useScanDocument';
import * as platformModule from '../platform';

afterEach(() => {
  vi.restoreAllMocks();
});

function renderAllEntryPointsForPlatform(platform: 'web' | 'electron' | 'android') {
  vi.spyOn(platformModule, 'getPlatformType').mockReturnValue(platform);
  const homeHtml = renderToString(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <ViewerProvider>
          <HomePage />
        </ViewerProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  const sidebarHtml = renderToString(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <ViewerProvider>
          <Sidebar onCloseDrawer={() => {}} isCollapsed={false} />
        </ViewerProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  const paletteHtml = renderToString(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <ViewerProvider>
          <CommandPalette isOpen={true} onClose={() => {}} />
        </ViewerProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  const aboutHtml = renderToString(
    <MemoryRouter initialEntries={['/about']}>
      <ToastProvider>
        <ViewerProvider>
          <AboutPage />
        </ViewerProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  return { homeHtml, sidebarHtml, paletteHtml, aboutHtml };
}

describe('Android-only Document Scanner UI entry points and Viewer handoff', () => {
  it('completely omits Scan Document and Android OpenCV notices on Web and Electron', () => {
    for (const platform of ['web', 'electron'] as const) {
      const { homeHtml, sidebarHtml, paletteHtml, aboutHtml } = renderAllEntryPointsForPlatform(platform);
      expect(homeHtml).not.toContain('Scan Document');
      expect(sidebarHtml).not.toContain('Scan Document');
      expect(paletteHtml).not.toContain('Scan Document');
      expect(aboutHtml).not.toContain('OpenCV for Android');
    }
  });

  it('exposes Scan Document on Android HomePage, Create group, Sidebar, CommandPalette, and OpenCV notice in AboutPage', () => {
    const { homeHtml, sidebarHtml, paletteHtml, aboutHtml } = renderAllEntryPointsForPlatform('android');
    const homeMatches = homeHtml.match(/Scan Document/g) ?? [];
    expect(homeMatches.length).toBeGreaterThanOrEqual(2);
    expect(sidebarHtml).toContain('Scan Document');
    expect(paletteHtml).toContain('Scan Document');
    expect(aboutHtml).toContain('OpenCV 4.12.0');
    expect(aboutHtml).toContain('libjpeg-turbo');
  });

  it('opens completed PDF in Viewer and handles cancellation, errors, and non-Android platforms safely', async () => {
    const loadFile = vi.fn();
    const setIsLoading = vi.fn();
    const showToast = vi.fn();

    // Web/Desktop safely return unsupported without calling native scanner
    const scanNeverCalled = vi.fn();
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast,
        scanFn: scanNeverCalled,
        platform: 'web',
      }),
    ).toBe('unsupported');
    expect(scanNeverCalled).not.toHaveBeenCalled();

    // Cancelled scan leaves Viewer and toasts untouched
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast,
        scanFn: async () => ({ status: 'cancelled' }),
        platform: 'android',
      }),
    ).toBe('cancelled');
    expect(loadFile).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();

    // Completed scan loads PDF file directly into Viewer
    const scannedFile = { name: 'Scan_1.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) };
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast,
        scanFn: async () => ({ status: 'completed', file: scannedFile, pageCount: 2 }),
        platform: 'android',
      }),
    ).toBe('completed');
    expect(loadFile).toHaveBeenCalledWith(scannedFile);

    // Failed scan or inaccessible URI surfaces toast and clears loading state
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast,
        scanFn: async () => {
          throw new Error('Could not read scanned PDF (HTTP 404).');
        },
        platform: 'android',
      }),
    ).toBe('error');
    expect(setIsLoading).toHaveBeenCalledWith(false);
    expect(showToast).toHaveBeenCalledWith('Could not read scanned PDF (HTTP 404).');
  });
});
