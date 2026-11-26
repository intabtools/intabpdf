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

  it('never opens PDF Viewer from scanner handoff and handles cancellation, errors, and non-Android platforms safely', async () => {
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

    // Completed scan with save action routes to Save without opening Viewer
    const scannedFile = { name: 'Scan_1.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) };
    const saveFile = vi.fn().mockResolvedValue({
      saved: true,
      outcome: 'saved',
      fileName: 'Scan_1.pdf',
      displayPath: 'Documents/InTabPDF',
    });
    const sharePdf = vi.fn();
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast,
        saveFile,
        sharePdf,
        scanFn: async () => ({ status: 'completed', action: 'save', file: scannedFile, pageCount: 2 }),
        platform: 'android',
      }),
    ).toBe('saved');
    expect(loadFile).not.toHaveBeenCalled();
    expect(saveFile).toHaveBeenCalledWith(scannedFile.bytes, 'Scan_1.pdf', 'application/pdf');
    expect(sharePdf).not.toHaveBeenCalled();

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
    expect(loadFile).not.toHaveBeenCalled();
  });

  it('routes Save PDF through SAF saveFile without opening Viewer or Share, and handles cancel/recovery/error', async () => {
    const scannedFile = { name: 'Scan_2.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) };
    const loadFile = vi.fn();
    const setIsLoading = vi.fn();
    const sharePdf = vi.fn();

    // Successful SAF save
    const showToastSuccess = vi.fn();
    const saveSuccess = vi.fn().mockResolvedValue({
      saved: true,
      outcome: 'saved',
      fileName: 'Scan_2.pdf',
      displayPath: 'Documents/InTabPDF',
    });
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast: showToastSuccess,
        saveFile: saveSuccess,
        sharePdf,
        scanFn: async () => ({ status: 'completed', action: 'save', file: scannedFile, pageCount: 1 }),
        platform: 'android',
      }),
    ).toBe('saved');
    expect(saveSuccess).toHaveBeenCalledWith(scannedFile.bytes, 'Scan_2.pdf', 'application/pdf');
    expect(loadFile).not.toHaveBeenCalled();
    expect(sharePdf).not.toHaveBeenCalled();
    expect(showToastSuccess).toHaveBeenCalledWith('Saved Scan_2.pdf to Documents/InTabPDF');

    // Cancelled SAF picker must NOT show a success toast
    const showToastCancel = vi.fn();
    const saveCancelled = vi.fn().mockResolvedValue({ saved: false, outcome: 'cancelled' });
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast: showToastCancel,
        saveFile: saveCancelled,
        sharePdf,
        scanFn: async () => ({ status: 'completed', action: 'save', file: scannedFile, pageCount: 1 }),
        platform: 'android',
      }),
    ).toBe('cancelled');
    expect(loadFile).not.toHaveBeenCalled();
    expect(showToastCancel).toHaveBeenCalledWith('Save cancelled');
    expect(showToastCancel.mock.calls.flat().join(' ')).not.toMatch(/Saved Scan/i);

    // Recovery available attaches retry callback
    const showToastRecovery = vi.fn();
    const attachRetrySave = vi.fn();
    const saveRecoveryFailed = vi.fn().mockResolvedValue({
      saved: false,
      outcome: 'failed_recovery_available',
      originalIntact: false,
      message: 'SAF write interrupted',
      recovery: { recoveryId: 'rec-1' },
    });
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast: showToastRecovery,
        saveFile: saveRecoveryFailed,
        sharePdf,
        attachRetrySave,
        scanFn: async () => ({ status: 'completed', action: 'save', file: scannedFile, pageCount: 1 }),
        platform: 'android',
      }),
    ).toBe('error');
    expect(attachRetrySave).toHaveBeenCalledTimes(1);
    expect(showToastRecovery).toHaveBeenCalledWith('SAF write interrupted', 4000);
    expect(loadFile).not.toHaveBeenCalled();
  });

  it('routes Share through sharePdf without saving via SAF or opening Viewer', async () => {
    const scannedFile = { name: 'Scan_3.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) };
    const loadFile = vi.fn();
    const setIsLoading = vi.fn();
    const saveFile = vi.fn();
    const showToast = vi.fn();

    const shareSuccess = vi.fn().mockResolvedValue({
      ok: true,
      status: 'shared',
      message: 'Shared PDF',
    });
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast,
        saveFile,
        sharePdf: shareSuccess,
        scanFn: async () => ({ status: 'completed', action: 'share', file: scannedFile, pageCount: 1 }),
        platform: 'android',
      }),
    ).toBe('shared');
    expect(shareSuccess).toHaveBeenCalledWith({ fileName: 'Scan_3.pdf', bytes: scannedFile.bytes });
    expect(loadFile).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();

    const shareCanceled = vi.fn().mockResolvedValue({
      ok: false,
      status: 'canceled',
      message: 'Share cancelled',
    });
    expect(
      await runScanToViewerHandoff({
        loadFile,
        setIsLoading,
        showToast,
        saveFile,
        sharePdf: shareCanceled,
        scanFn: async () => ({ status: 'completed', action: 'share', file: scannedFile, pageCount: 1 }),
        platform: 'android',
      }),
    ).toBe('cancelled');
    expect(loadFile).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });
});
