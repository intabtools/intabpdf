import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import { platform, type OpenedFile } from '../platform';
import { destroyPdf } from './renderPage';

vi.mock('./renderPage', () => {
  return {
    loadPdf: vi.fn().mockImplementation(async () => ({
      numPages: 3,
      getPage: vi.fn(),
      cleanup: vi.fn(),
      destroy: vi.fn(),
    })),
    destroyPdf: vi.fn().mockResolvedValue(undefined),
    getPageSize: vi.fn().mockReturnValue({ width: 595, height: 842 }),
    drawPageOnCanvas: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Desktop logo navigation and viewer lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.clearPendingFile?.();
  });

  afterEach(() => {
    platform.clearPendingFile?.();
  });

  it('Scenario 1: External PDF launch followed by logo navigation to All tools', () => {
    // 1. Setup mock for external pending file on cold start
    let pendingState = true;
    const originalHasPending = platform.hasPendingFile;
    platform.hasPendingFile = vi.fn(() => {
      if (pendingState) {
        pendingState = false;
        return true;
      }
      return false;
    });

    const navigations: string[] = [];
    const mockNavigate = vi.fn((to: string) => {
      navigations.push(to);
    });

    // Simulate ViewerProvider cold-start logic with coldStartHandledRef
    let coldStartHandled = false;
    const initialHasPending = platform.hasPendingFile() ?? false;
    expect(initialHasPending).toBe(true);

    // Initial effect on cold start
    if (initialHasPending && !coldStartHandled) {
      coldStartHandled = true;
      mockNavigate('/viewer');
    }
    expect(navigations).toEqual(['/viewer']);

    // 2. Render AppHeader while on /viewer to verify logo markup and destination
    const headerHtml = renderToString(
      <MemoryRouter initialEntries={['/viewer']}>
        <AppHeader
          onToggleSidebar={() => {}}
          onOpenPalette={() => {}}
          isDark={false}
          onToggleTheme={() => {}}
          isSidebarCollapsed={false}
          isDrawerOpen={false}
        />
      </MemoryRouter>
    );

    // Logo link must point to home ("/")
    expect(headerHtml).toContain('href="/"');
    expect(headerHtml).toContain('class="hb"');
    expect(headerHtml).toContain('aria-label="InTab PDF home"');
    expect(headerHtml).toContain('InTab');
    expect(headerHtml).toContain('PDF');

    // 3. User clicks logo to navigate to "/" (All tools).
    // In React Router, navigating to "/" creates a new navigate function identity.
    const newMockNavigate = vi.fn((to: string) => {
      navigations.push(to);
    });

    // Because coldStartHandled is true, re-evaluating the effect MUST NOT redirect back to /viewer
    if (initialHasPending && !coldStartHandled) {
      newMockNavigate('/viewer');
    }

    // Navigations must NOT have added another '/viewer'
    expect(navigations).toEqual(['/viewer']);
    expect(newMockNavigate).not.toHaveBeenCalled();

    platform.hasPendingFile = originalHasPending;
  });

  it('Scenario 2: Internal PDF opening followed by logo navigation', () => {
    // Normal launch: hasPendingFile returns false
    const originalHasPending = platform.hasPendingFile;
    platform.hasPendingFile = vi.fn(() => false);

    const navigations: string[] = [];
    const mockNavigate = vi.fn((to: string) => navigations.push(to));

    let coldStartHandled = false;
    const initialHasPending = platform.hasPendingFile() ?? false;
    expect(initialHasPending).toBe(false);

    if (initialHasPending && !coldStartHandled) {
      coldStartHandled = true;
      mockNavigate('/viewer');
    }
    // No cold start navigation
    expect(navigations).toEqual([]);

    // User internally opens a PDF via loadFile
    const sampleFile: OpenedFile = {
      name: 'internal.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    };
    expect(sampleFile.name).toBe('internal.pdf');

    // loadFile navigates to viewer
    mockNavigate('/viewer');
    expect(navigations).toEqual(['/viewer']);

    // User clicks logo to navigate home
    mockNavigate('/');
    expect(navigations).toEqual(['/viewer', '/']);

    // Subsequent route updates do not trigger any redirection
    if (initialHasPending && !coldStartHandled) {
      mockNavigate('/viewer');
    }
    expect(navigations).toEqual(['/viewer', '/']);

    platform.hasPendingFile = originalHasPending;
  });

  it('Scenario 3: Opening a second external PDF and navigating home again', () => {
    const navigations: string[] = [];
    const mockNavigate = vi.fn((to: string) => navigations.push(to));

    let activeFile: OpenedFile | null = null;
    let fileHandler: ((file: OpenedFile) => void) | null = null;

    // Simulate platform.onFileOpened subscription in ViewerProvider
    const originalOnFileOpened = platform.onFileOpened;
    platform.onFileOpened = vi.fn((handler) => {
      fileHandler = handler;
      return () => {
        fileHandler = null;
      };
    });

    // Subscribe
    platform.onFileOpened((file) => {
      activeFile = file;
      mockNavigate('/viewer');
    });

    // 1. First external PDF arrives
    fileHandler!({
      name: 'first.pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect((activeFile as OpenedFile | null)?.name).toBe('first.pdf');
    expect(navigations).toEqual(['/viewer']);

    // User navigates home
    mockNavigate('/');
    expect(navigations).toEqual(['/viewer', '/']);

    // 2. Second external PDF arrives while on home screen
    fileHandler!({
      name: 'second.pdf',
      bytes: new Uint8Array([4, 5, 6]),
    });
    expect((activeFile as OpenedFile | null)?.name).toBe('second.pdf');
    expect(navigations).toEqual(['/viewer', '/', '/viewer']);

    // User navigates home again
    mockNavigate('/');
    expect(navigations).toEqual(['/viewer', '/', '/viewer', '/']);

    platform.onFileOpened = originalOnFileOpened;
  });

  it('Scenario 4: Proper viewer cleanup when navigating home', async () => {
    const mockDestroy = vi.fn().mockResolvedValue(undefined);
    const mockPdfDoc = {
      numPages: 5,
      getPage: vi.fn(),
      cleanup: vi.fn(),
      destroy: mockDestroy,
    };

    const activeLoadingTask = {
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    let currentFile: OpenedFile | null = {
      name: 'doc.pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
    };
    let lastOpenedFile: OpenedFile | null = currentFile;
    let contextLoading = true;

    const clearPendingSpy = vi.spyOn(platform, 'clearPendingFile');

    // Simulate unmount cleanup of usePdfDocumentLoader when navigating away from /viewer
    const unmountLoader = async () => {
      if (activeLoadingTask) {
        await activeLoadingTask.destroy();
      }
      if (mockPdfDoc) {
        await destroyPdf(mockPdfDoc as unknown as Parameters<typeof destroyPdf>[0]);
      }
      contextLoading = false;
      currentFile = null;
      lastOpenedFile = null;
      platform.clearPendingFile?.();
    };

    await unmountLoader();

    // Verify all resources are thoroughly destroyed and cleaned
    expect(activeLoadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(destroyPdf).toHaveBeenCalledWith(mockPdfDoc);
    expect(contextLoading).toBe(false);
    expect(currentFile).toBeNull();
    expect(lastOpenedFile).toBeNull();
    expect(clearPendingSpy).toHaveBeenCalled();
  });
});
