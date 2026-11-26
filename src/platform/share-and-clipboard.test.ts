import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as platformModule from './index';
import { copyTextToClipboard } from './clipboard';
import { sharePdfDocument, shareSelectedText } from './share';
import { readDocumentAllowCopying } from '../viewer/renderPage';
import { PermissionFlag } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const electronSecurity = require('../../electron/security.cjs') as {
  isAllowedPermission: (perm: string, originUrl: string, fn: (u: string) => boolean) => boolean;
  isViewerUrl: (rawUrl: string) => boolean;
  buildContextMenuTemplate: (opts: {
    selectionText?: string;
    isEditable?: boolean;
    isViewerRoute?: boolean;
    viewerCopyAllowed?: boolean;
    onCopy?: (t: string) => void;
    onSelectAll?: () => void;
  }) => Array<{ label?: string; role?: string; enabled?: boolean; type?: string; click?: () => void }>;
};

const mockShare = {
  canShare: vi.fn(async () => ({ value: true })),
  share: vi.fn(async () => ({ activityType: 'test.share' })),
};

const mockFilesystem = {
  readdir: vi.fn(async () => ({ files: [] })),
  writeFile: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///cache/${path}` })),
  deleteFile: vi.fn(async () => undefined),
};

vi.mock('@capacitor/share', () => ({ Share: mockShare }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: mockFilesystem,
  Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
}));

describe('Phase 5 & 6: Electron Security, Clipboard, Context Menu & Sharing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('allows only clipboard permissions for trusted origins and denies all others', () => {
    const trustedOriginCheck = (url: string) => url.startsWith('http://localhost:5173');

    expect(
      electronSecurity.isAllowedPermission('clipboard-sanitized-write', 'http://localhost:5173/viewer', trustedOriginCheck),
    ).toBe(true);
    expect(
      electronSecurity.isAllowedPermission('clipboard-read', 'http://localhost:5173/viewer', trustedOriginCheck),
    ).toBe(true);

    // Deny unrelated permissions even from trusted origin
    expect(
      electronSecurity.isAllowedPermission('media', 'http://localhost:5173/viewer', trustedOriginCheck),
    ).toBe(false);
    expect(
      electronSecurity.isAllowedPermission('geolocation', 'http://localhost:5173/viewer', trustedOriginCheck),
    ).toBe(false);
    expect(
      electronSecurity.isAllowedPermission('notifications', 'http://localhost:5173/viewer', trustedOriginCheck),
    ).toBe(false);

    // Deny clipboard permission from untrusted or empty origin
    expect(
      electronSecurity.isAllowedPermission('clipboard-sanitized-write', 'https://evil.example.com', trustedOriginCheck),
    ).toBe(false);
    expect(
      electronSecurity.isAllowedPermission('clipboard-read', '', trustedOriginCheck),
    ).toBe(false);
  });

  it('recognizes viewer URLs across BrowserRouter and HashRouter and excludes non-viewer routes', () => {
    expect(electronSecurity.isViewerUrl('http://localhost:5173/viewer')).toBe(true);
    expect(electronSecurity.isViewerUrl('http://localhost:5173/viewer?platform=electron')).toBe(true);
    expect(electronSecurity.isViewerUrl('file:///app/dist/index.html#/viewer')).toBe(true);
    expect(electronSecurity.isViewerUrl('file:///app/dist/index.html#/viewer?platform=electron')).toBe(true);

    expect(electronSecurity.isViewerUrl('http://localhost:5173/')).toBe(false);
    expect(electronSecurity.isViewerUrl('http://localhost:5173/about')).toBe(false);
    expect(electronSecurity.isViewerUrl('http://localhost:5173/tool/merge?next=/viewer')).toBe(false);
    expect(electronSecurity.isViewerUrl('file:///app/dist/index.html#/tool/protect')).toBe(false);
    expect(electronSecurity.isViewerUrl('')).toBe(false);
  });

  it('builds context menu respecting selection range, route scoping, and viewer copy permissions', () => {
    const copied: string[] = [];
    let selectedAll = false;

    const withSelection = electronSecurity.buildContextMenuTemplate({
      selectionText: 'Selected PDF text',
      isEditable: false,
      isViewerRoute: true,
      viewerCopyAllowed: true,
      onCopy: (t) => copied.push(t),
      onSelectAll: () => {
        selectedAll = true;
      },
    });
    expect(withSelection.find((i) => i.label === 'Copy')?.enabled).toBe(true);
    expect(withSelection.find((i) => i.label === 'Select All on Page')?.enabled).toBe(true);
    withSelection.find((i) => i.label === 'Copy')?.click?.();
    withSelection.find((i) => i.label === 'Select All on Page')?.click?.();
    expect(copied).toEqual(['Selected PDF text']);
    expect(selectedAll).toBe(true);

    const noSelection = electronSecurity.buildContextMenuTemplate({
      selectionText: '   ',
      isEditable: false,
      isViewerRoute: true,
      viewerCopyAllowed: true,
    });
    expect(noSelection.find((i) => i.label === 'Copy')?.enabled).toBe(false);

    const copyRestricted = electronSecurity.buildContextMenuTemplate({
      selectionText: 'Secret text',
      isEditable: false,
      isViewerRoute: true,
      viewerCopyAllowed: false,
    });
    expect(copyRestricted.find((i) => i.label === 'Copy')).toBeUndefined();
    expect(copyRestricted[0]).toEqual({
      label: 'Copy disabled by PDF permissions',
      enabled: false,
    });

    // Non-viewer routes (Home, About, Tool pages) must NOT expose "Select All on Page"
    const homeOrToolMenu = electronSecurity.buildContextMenuTemplate({
      selectionText: 'Tool description text',
      isEditable: false,
      isViewerRoute: false,
      viewerCopyAllowed: false,
      onCopy: (t) => copied.push(t),
      onSelectAll: () => {
        throw new Error('Must not fire viewer select-all on non-viewer route');
      },
    });
    expect(homeOrToolMenu.find((i) => i.label === 'Select All on Page')).toBeUndefined();
    expect(homeOrToolMenu.find((i) => i.label === 'Copy')?.enabled).toBe(true);
    expect(homeOrToolMenu.find((i) => i.role === 'selectAll')).toBeDefined();
  });

  it('copies text through Electron IPC bridge first and falls back to navigator.clipboard', async () => {
    const ipcCopy = vi.fn(async () => true);
    vi.stubGlobal('window', { intab: { copyText: ipcCopy } });
    expect(await copyTextToClipboard('Electron text')).toBe(true);
    expect(ipcCopy).toHaveBeenCalledWith('Electron text');

    const navWrite = vi.fn(async () => undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { clipboard: { writeText: navWrite } });
    expect(await copyTextToClipboard('Web text')).toBe(true);
    expect(navWrite).toHaveBeenCalledWith('Web text');
  });

  it('shares PDF from Android via Cache FileProvider URI and shares selected text via Capacitor Share', async () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('android');
    const pdfOutcome = await sharePdfDocument({
      fileName: 'report.pdf',
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
    });

    expect(pdfOutcome.ok).toBe(true);
    expect(pdfOutcome.status).toBe('shared');
    expect(mockFilesystem.writeFile).toHaveBeenCalled();
    expect(mockShare.share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'report.pdf',
        url: expect.stringContaining('report.pdf'),
      }),
    );

    mockShare.share.mockClear();
    const multilineText = '  First line\n  Indented second line\n\nThird paragraph  ';
    const textOutcome = await shareSelectedText(multilineText);
    expect(textOutcome.ok).toBe(true);
    expect(textOutcome.status).toBe('shared');
    expect(mockShare.share).toHaveBeenCalledWith(
      expect.objectContaining({ text: multilineText }),
    );
    // Must not attach a file URL when sharing selected text
    expect(mockShare.share).not.toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.any(String) }),
    );

    // Cancellation handling on Android
    mockShare.share.mockRejectedValueOnce(new Error('Share canceled'));
    const canceledOutcome = await shareSelectedText('Sample text');
    expect(canceledOutcome.ok).toBe(false);
    expect(canceledOutcome.status).toBe('canceled');

    // Error failure handling on Android
    mockShare.share.mockRejectedValueOnce(new Error('ActivityNotFoundException'));
    const errorOutcome = await shareSelectedText('Sample text');
    expect(errorOutcome.ok).toBe(false);
    expect(errorOutcome.status).toBe('unsupported');

    // Empty / whitespace-only selection rejected cleanly
    const emptyOutcome = await shareSelectedText('   \n\t  ');
    expect(emptyOutcome.ok).toBe(false);
    expect(emptyOutcome.status).toBe('invalid');
  });

  it('shares PDF on Web via navigator.share({ files }) when supported and falls back to download when unavailable', async () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('web');
    const webShareSpy = vi.fn(async () => undefined);
    const webCanShareSpy = vi.fn(() => true);
    vi.stubGlobal('File', class MockFile {
      name: string;
      type: string;
      constructor(_parts: unknown[], name: string, opts: { type: string }) {
        this.name = name;
        this.type = opts.type;
      }
    });
    vi.stubGlobal('navigator', { share: webShareSpy, canShare: webCanShareSpy });

    const sharedOutcome = await sharePdfDocument({
      fileName: 'web-doc',
      bytes: new Uint8Array([37, 80, 68, 70]),
    });
    expect(sharedOutcome.ok).toBe(true);
    expect(sharedOutcome.status).toBe('shared');
    expect(webShareSpy).toHaveBeenCalled();

    // Unavailable Web Share -> falls back cleanly to saveFile
    vi.stubGlobal('navigator', {});
    const saveSpy = vi.spyOn(platformModule.platform, 'saveFile').mockResolvedValue({
      saved: true,
      fileName: 'web-doc.pdf',
    });
    const fallbackOutcome = await sharePdfDocument({
      fileName: 'web-doc',
      bytes: new Uint8Array([37, 80, 68, 70]),
    });
    expect(fallbackOutcome.ok).toBe(true);
    expect(fallbackOutcome.status).toBe('saved-fallback');
    expect(saveSpy).toHaveBeenCalled();
  });

  it('does not falsely report success for Electron PDF Share when unsupported, and rejects missing documents', async () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('electron');
    vi.stubGlobal('navigator', {});

    const invalidOutcome = await sharePdfDocument({ fileName: 'empty.pdf', bytes: new Uint8Array(0) });
    expect(invalidOutcome.ok).toBe(false);
    expect(invalidOutcome.status).toBe('invalid');

    const unsupportedOutcome = await sharePdfDocument({
      fileName: 'doc.pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
    });
    expect(unsupportedOutcome.ok).toBe(false);
    expect(unsupportedOutcome.status).toBe('unsupported');

    // Electron selected-text Share uses clipboard fallback and reports accurately
    const ipcCopy = vi.fn(async () => true);
    vi.stubGlobal('window', { intab: { copyText: ipcCopy } });
    const electronTextOutcome = await shareSelectedText('Line A\nLine B');
    expect(electronTextOutcome.ok).toBe(true);
    expect(electronTextOutcome.status).toBe('copied');
    expect(electronTextOutcome.message).toMatch(/copied text to clipboard/i);
    expect(ipcCopy).toHaveBeenCalledWith('Line A\nLine B');
  });

  it('interprets PDF.js getPermissions correctly across Set/Array results for unrestricted, copy-restricted, and accessibility-only PDFs', async () => {
    const nullDoc = { getPermissions: async () => null } as unknown as import('../viewer/renderPage').PdfDocument;
    expect(await readDocumentAllowCopying(nullDoc)).toBe(true);

    const fullSetDoc = {
      getPermissions: async () => new Set([PermissionFlag.PRINT, PermissionFlag.COPY]),
    } as unknown as import('../viewer/renderPage').PdfDocument;
    expect(await readDocumentAllowCopying(fullSetDoc)).toBe(true);

    const fullArrayDoc = {
      getPermissions: async () => [PermissionFlag.PRINT, PermissionFlag.COPY],
    } as unknown as import('../viewer/renderPage').PdfDocument;
    expect(await readDocumentAllowCopying(fullArrayDoc)).toBe(true);

    // Accessibility-only extraction (COPY_FOR_ACCESSIBILITY = 512 without COPY = 16) in PDF.js v6 Set
    const accessibilityOnlySetDoc = {
      getPermissions: async () => new Set([PermissionFlag.PRINT, PermissionFlag.COPY_FOR_ACCESSIBILITY]),
    } as unknown as import('../viewer/renderPage').PdfDocument;
    expect(await readDocumentAllowCopying(accessibilityOnlySetDoc)).toBe(false);
  });
});
