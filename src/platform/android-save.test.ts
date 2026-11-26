import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveFileAndroid,
  splitFileName,
  suggestUniqueFileName,
  type DocumentSavePlugin,
} from './androidSave';
import { setConflictPromptHandler, type ConflictResolution } from './conflictDialog';

const shareMock = vi.fn();

vi.mock('@capacitor/share', () => ({
  Share: {
    canShare: vi.fn(async () => ({ value: true })),
    share: shareMock,
  },
}));

describe('Android SAF file saving and conflict protection', () => {
  let safFiles: Map<string, { data: string; flags: 'full' | 'wt_only' | 'read_only' }>;
  let folderCancelled = false;
  let needsReselectOnce = false;

  const createMockPlugin = (): DocumentSavePlugin => ({
    prepareSaveDestination: vi.fn(async () => {
      if (folderCancelled) {
        return { ready: false, cancelled: true };
      }
      return {
        ready: true,
        cancelled: false,
        folderUri: 'content://com.android.externalstorage.documents/tree/primary%3ADocuments/document/primary%3ADocuments%2FInTabPDF',
        displayPath: 'Documents/InTabPDF',
        existingNames: Array.from(safFiles.keys()),
      };
    }),

    writeToDestination: vi.fn(async ({ fileName, base64Data, replaceExisting }) => {
      if (needsReselectOnce) {
        needsReselectOnce = false;
        return { status: 'needs_folder_selection' as const };
      }

      const existingEntry = safFiles.get(fileName);
      if (existingEntry) {
        if (!replaceExisting) {
          const suggested = await suggestUniqueFileName(fileName, (n) => safFiles.has(n));
          return {
            status: 'conflict' as const,
            existingFileName: fileName,
            suggestedFileName: suggested,
          };
        }
        if (existingEntry.flags === 'read_only') {
          const suggested = await suggestUniqueFileName(fileName, (n) => safFiles.has(n));
          return {
            status: 'replace_unsupported' as const,
            existingFileName: fileName,
            suggestedFileName: suggested,
            reason: 'This storage provider does not allow safe replacement. Original file was kept untouched.',
          };
        }
      }

      safFiles.set(fileName, { data: base64Data, flags: 'full' });
      return {
        status: 'saved' as const,
        fileName,
        displayPath: 'Documents/InTabPDF',
        documentUri: `content://com.android.externalstorage.documents/document/${encodeURIComponent(fileName)}`,
        bytesWritten: base64Data.length,
        replaced: Boolean(existingEntry),
      };
    }),
  });

  beforeEach(() => {
    safFiles = new Map();
    folderCancelled = false;
    needsReselectOnce = false;
    shareMock.mockClear();
    setConflictPromptHandler(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('splitFileName and suggestUniqueFileName helpers', () => {
    it('splits base and extension cleanly', () => {
      expect(splitFileName('document.pdf')).toEqual({ base: 'document', ext: '.pdf' });
      expect(splitFileName('archive.tar.gz')).toEqual({ base: 'archive.tar', ext: '.gz' });
      expect(splitFileName('noext')).toEqual({ base: 'noext', ext: '' });
      expect(splitFileName('.hidden')).toEqual({ base: '.hidden', ext: '' });
    });

    it('suggests incremental deduplicated filenames without collisions', async () => {
      const existing = new Set(['report.pdf', 'report (1).pdf']);
      expect(await suggestUniqueFileName('report.pdf', (n) => existing.has(n))).toBe('report (2).pdf');
      expect(await suggestUniqueFileName('report (1).pdf', (n) => existing.has(n))).toBe('report (2).pdf');
    });
  });

  describe('saveFileAndroid SAF workflow', () => {
    it('saves directly into Documents/InTabPDF without invoking Capacitor Share', async () => {
      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([1, 2, 3, 4]), 'new-file.pdf', 'application/pdf', plugin);

      expect(result).toEqual({
        saved: true,
        fileName: 'new-file.pdf',
        displayPath: 'Documents/InTabPDF',
      });
      expect(safFiles.has('new-file.pdf')).toBe(true);
      expect(shareMock).not.toHaveBeenCalled();
    });

    it('returns saved=false silently when user cancels SAF folder picker', async () => {
      folderCancelled = true;
      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([1, 2, 3]), 'report.pdf', 'application/pdf', plugin);

      expect(result).toEqual({ saved: false });
      expect(safFiles.size).toBe(0);
    });

    it('preserves existing file when conflict dialog is cancelled', async () => {
      safFiles.set('existing.pdf', { data: 'b3JpZ2luYWw=', flags: 'full' });
      setConflictPromptHandler(async (fileName, suggestedName, options) => {
        expect(fileName).toBe('existing.pdf');
        expect(suggestedName).toBe('existing (1).pdf');
        expect(options?.displayPath).toBe('Documents/InTabPDF');
        return { action: 'cancel' };
      });

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([9, 9]), 'existing.pdf', 'application/pdf', plugin);
      expect(result).toEqual({ saved: false });
      expect(safFiles.get('existing.pdf')?.data).toBe('b3JpZ2luYWw=');
    });

    it('replaces existing file via SAF when user confirms Replace', async () => {
      safFiles.set('target.pdf', { data: 'b2xk', flags: 'full' });
      setConflictPromptHandler(async () => ({ action: 'replace' }));

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([8, 8, 8]), 'target.pdf', 'application/pdf', plugin);
      expect(result).toEqual({
        saved: true,
        fileName: 'target.pdf',
        displayPath: 'Documents/InTabPDF',
      });
      expect(safFiles.get('target.pdf')?.data).not.toBe('b2xk');
      expect(shareMock).not.toHaveBeenCalled();
    });

    it('preserves extension when saving as new copy and handles replace_unsupported cleanly', async () => {
      safFiles.set('locked.pdf', { data: 'bG9ja2Vk', flags: 'read_only' });
      const seenPrompts: Array<{ fileName: string; replaceDisabledReason?: string }> = [];

      setConflictPromptHandler(async (fileName, _suggested, options) => {
        seenPrompts.push({ fileName, replaceDisabledReason: options?.replaceDisabledReason });
        if (seenPrompts.length === 1) {
          return { action: 'replace' };
        }
        return { action: 'rename', newFileName: 'locked-copy' };
      });

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([5, 5]), 'locked.pdf', 'application/pdf', plugin);
      expect(result).toEqual({
        saved: true,
        fileName: 'locked-copy.pdf',
        displayPath: 'Documents/InTabPDF',
      });
      expect(seenPrompts).toHaveLength(2);
      expect(seenPrompts[1].replaceDisabledReason).toContain('Original file was kept untouched');
      expect(safFiles.get('locked.pdf')?.data).toBe('bG9ja2Vk');
      expect(safFiles.has('locked-copy.pdf')).toBe(true);
    });

    it('re-prompts destination selection if persisted access was revoked before write', async () => {
      needsReselectOnce = true;
      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([4, 5, 6]), 'reselect.pdf', 'application/pdf', plugin);

      expect(result.saved).toBe(true);
      expect(plugin.prepareSaveDestination).toHaveBeenCalledTimes(2);
    });

    it('re-prompts if user enters a custom name that also collides case-insensitively', async () => {
      safFiles.set('first.pdf', { data: 'Zmlyc3Q=', flags: 'full' });
      safFiles.set('Second.pdf', { data: 'c2Vjb25k', flags: 'full' });

      let callNum = 0;
      setConflictPromptHandler(async (fileName) => {
        callNum++;
        if (callNum === 1) {
          return { action: 'rename', newFileName: 'second.pdf' };
        }
        expect(fileName).toBe('Second.pdf');
        return { action: 'rename', newFileName: 'third' };
      });

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([1, 2]), 'first.pdf', 'application/pdf', plugin);
      expect(result.saved).toBe(true);
      expect(result.fileName).toBe('third.pdf');
    });

    it('prevents concurrent save operations from racing', async () => {
      safFiles.set('concurrent.pdf', { data: 'ZGF0YQ==', flags: 'full' });

      let resolvePrompt!: (res: ConflictResolution) => void;
      setConflictPromptHandler(
        () =>
          new Promise<ConflictResolution>((resolve) => {
            resolvePrompt = resolve;
          }),
      );

      const plugin = createMockPlugin();
      const p1 = saveFileAndroid(new Uint8Array([1]), 'concurrent.pdf', 'application/pdf', plugin);
      await expect(
        saveFileAndroid(new Uint8Array([2]), 'concurrent.pdf', 'application/pdf', plugin),
      ).rejects.toThrow('A save operation is already in progress.');

      resolvePrompt({ action: 'cancel' });
      expect(await p1).toEqual({ saved: false });
    });
  });
});
