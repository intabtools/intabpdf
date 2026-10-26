import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  splitFileName,
  suggestUniqueFileName,
  safeReplaceFile,
  saveFileAndroid,
} from './androidSave';
import {
  setConflictPromptHandler,
  type ConflictResolution,
} from './conflictDialog';

// In-memory virtual filesystem for Directory.Documents and Directory.Cache
const documentsStore = new Map<string, string>();
const cacheStore = new Map<string, string>();

let renameFailFilter: ((from: string) => boolean) | null = null;

vi.mock('@capacitor/filesystem', () => {
  const Directory = {
    Documents: 'DOCUMENTS',
    Cache: 'CACHE',
  };

  const Filesystem = {
    stat: vi.fn(async (options: { path: string; directory?: string }) => {
      const store = options.directory === Directory.Cache ? cacheStore : documentsStore;
      if (store.has(options.path)) {
        return {
          type: 'file',
          size: store.get(options.path)!.length,
          mtime: Date.now(),
          ctime: Date.now(),
          uri: `file:///virtual/${options.path}`,
        };
      }
      throw new Error('File does not exist');
    }),

    writeFile: vi.fn(async (options: { path: string; data: string; directory?: string }) => {
      const store = options.directory === Directory.Cache ? cacheStore : documentsStore;
      store.set(options.path, options.data);
      return { uri: `file:///virtual/${options.path}` };
    }),

    rename: vi.fn(async (options: { from: string; to: string; directory?: string }) => {
      if (renameFailFilter && renameFailFilter(options.from)) {
        throw new Error('Simulated disk I/O error during rename');
      }
      const store = options.directory === Directory.Cache ? cacheStore : documentsStore;
      if (!store.has(options.from)) {
        throw new Error(`Cannot rename non-existent file ${options.from}`);
      }
      const data = store.get(options.from)!;
      store.delete(options.from);
      store.set(options.to, data);
    }),

    deleteFile: vi.fn(async (options: { path: string; directory?: string }) => {
      const store = options.directory === Directory.Cache ? cacheStore : documentsStore;
      if (!store.has(options.path)) {
        throw new Error(`Cannot delete non-existent file ${options.path}`);
      }
      store.delete(options.path);
    }),
  };

  return { Directory, Filesystem };
});

describe('Android safe file saving and conflict protection', () => {
  beforeEach(() => {
    documentsStore.clear();
    cacheStore.clear();
    renameFailFilter = null;
    setConflictPromptHandler(null);
  });

  describe('splitFileName helper', () => {
    it('splits base and extension correctly', () => {
      expect(splitFileName('document.pdf')).toEqual({ base: 'document', ext: '.pdf' });
      expect(splitFileName('archive.tar.gz')).toEqual({ base: 'archive.tar', ext: '.gz' });
      expect(splitFileName('noext')).toEqual({ base: 'noext', ext: '' });
      expect(splitFileName('.hidden')).toEqual({ base: '.hidden', ext: '' });
    });
  });

  describe('suggestUniqueFileName helper', () => {
    it('suggests "name (1).pdf" when "name.pdf" exists', async () => {
      const existing = new Set(['report.pdf']);
      const checkExists = async (name: string) => existing.has(name);

      const suggestion = await suggestUniqueFileName('report.pdf', checkExists);
      expect(suggestion).toBe('report (1).pdf');
    });

    it('suggests "name (2).pdf" when "name.pdf" and "name (1).pdf" exist', async () => {
      const existing = new Set(['report.pdf', 'report (1).pdf']);
      const checkExists = async (name: string) => existing.has(name);

      const suggestion = await suggestUniqueFileName('report.pdf', checkExists);
      expect(suggestion).toBe('report (2).pdf');
    });

    it('handles input already containing numeric suffix and increments to next available number', async () => {
      const existing = new Set(['document (1).pdf', 'document (2).pdf']);
      const checkExists = async (name: string) => existing.has(name);

      const suggestion = await suggestUniqueFileName('document (1).pdf', checkExists);
      expect(suggestion).toBe('document (3).pdf');
    });
  });

  describe('saveFileAndroid execution with mocked Filesystem', () => {
    it('saves directly when destination filename does not exist', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const result = await saveFileAndroid(bytes, 'new-file.pdf');

      expect(result).toEqual({ saved: true, fileName: 'new-file.pdf' });
      expect(documentsStore.has('new-file.pdf')).toBe(true);
      expect(cacheStore.has('new-file.pdf')).toBe(true);
    });

    it('detects existing file and aborts when user selects Cancel, preserving original file', async () => {
      documentsStore.set('existing.pdf', 'original-content-bytes');

      let promptCalled = false;
      setConflictPromptHandler(async (fileName, suggestedName) => {
        promptCalled = true;
        expect(fileName).toBe('existing.pdf');
        expect(suggestedName).toBe('existing (1).pdf');
        return { action: 'cancel' };
      });

      const newBytes = new Uint8Array([9, 9, 9]);
      const result = await saveFileAndroid(newBytes, 'existing.pdf');

      expect(promptCalled).toBe(true);
      expect(result).toEqual({ saved: false });
      // Original content is completely preserved
      expect(documentsStore.get('existing.pdf')).toBe('original-content-bytes');
      // Cache was not touched
      expect(cacheStore.has('existing.pdf')).toBe(false);
    });

    it('detects existing file and replaces it safely when user selects Replace', async () => {
      documentsStore.set('target.pdf', 'old-content');

      let promptCalled = false;
      setConflictPromptHandler(async () => {
        promptCalled = true;
        return { action: 'replace' };
      });

      const newBytes = new Uint8Array([8, 8, 8]);
      const result = await saveFileAndroid(newBytes, 'target.pdf');

      expect(promptCalled).toBe(true);
      expect(result).toEqual({ saved: true, fileName: 'target.pdf' });
      // Content updated in documents and mirrored to cache
      expect(documentsStore.has('target.pdf')).toBe(true);
      expect(documentsStore.get('target.pdf')).not.toBe('old-content');
      expect(cacheStore.has('target.pdf')).toBe(true);
    });

    it('detects existing file and saves under new filename when user selects Save as new name', async () => {
      documentsStore.set('sample.pdf', 'original-sample');

      setConflictPromptHandler(async (_fileName, suggestedName) => {
        expect(suggestedName).toBe('sample (1).pdf');
        return { action: 'rename', newFileName: 'sample (custom).pdf' };
      });

      const newBytes = new Uint8Array([7, 7, 7]);
      const result = await saveFileAndroid(newBytes, 'sample.pdf');

      expect(result).toEqual({ saved: true, fileName: 'sample (custom).pdf' });
      // Original file remains preserved
      expect(documentsStore.get('sample.pdf')).toBe('original-sample');
      // New file created separately
      expect(documentsStore.has('sample (custom).pdf')).toBe(true);
      expect(cacheStore.has('sample (custom).pdf')).toBe(true);
    });

    it('automatically ensures matching file extension if omitted by user during rename', async () => {
      documentsStore.set('document.pdf', 'orig');

      setConflictPromptHandler(async () => {
        // User typed "my-custom-doc" without .pdf extension
        return { action: 'rename', newFileName: 'my-custom-doc' };
      });

      const newBytes = new Uint8Array([5, 5]);
      const result = await saveFileAndroid(newBytes, 'document.pdf');

      expect(result.saved).toBe(true);
      expect(result.fileName).toBe('my-custom-doc.pdf');
      expect(documentsStore.has('my-custom-doc.pdf')).toBe(true);
    });

    it('throws error and does not report success when invalid empty name is provided', async () => {
      documentsStore.set('existing.pdf', 'data');

      setConflictPromptHandler(async () => {
        return { action: 'rename', newFileName: '   ' };
      });

      const newBytes = new Uint8Array([1, 2]);
      await expect(saveFileAndroid(newBytes, 'existing.pdf')).rejects.toThrow(
        'Invalid empty filename provided.'
      );
      expect(documentsStore.get('existing.pdf')).toBe('data');
    });

    it('safely handles conflict if destination appears between initial check and final write', async () => {
      documentsStore.set('race.pdf', 'orig-data');

      setConflictPromptHandler(async () => {
        // Between initial check and prompt return, "other.pdf" gets created on disk
        documentsStore.set('other.pdf', 'late-appearing-file');
        return { action: 'rename', newFileName: 'other.pdf' };
      });

      const newBytes = new Uint8Array([3, 4]);
      const result = await saveFileAndroid(newBytes, 'race.pdf');

      expect(result.saved).toBe(true);
      expect(result.fileName).toBe('other.pdf');
      // "other.pdf" was safely replaced without corrupting data
      expect(documentsStore.has('other.pdf')).toBe(true);
      // "race.pdf" remains untouched
      expect(documentsStore.get('race.pdf')).toBe('orig-data');
    });

    it('safely restores original file if replacement fails partway through', async () => {
      documentsStore.set('valuable.pdf', 'crucial-original-data');

      // Fail during rename of temporary file to target
      renameFailFilter = (from: string) => from.startsWith('.tmp_');

      const base64Data = 'bmV3LWRhdGE=';
      await expect(safeReplaceFile('valuable.pdf', base64Data)).rejects.toThrow(
        'Simulated disk I/O error during rename'
      );

      // Crucial verification: original file is intact and restored!
      expect(documentsStore.get('valuable.pdf')).toBe('crucial-original-data');
    });

    it('prevents concurrent save operations from racing', async () => {
      documentsStore.set('concurrent.pdf', 'data');

      let resolvePrompt!: (res: ConflictResolution) => void;
      setConflictPromptHandler(() => {
        return new Promise<ConflictResolution>((r) => {
          resolvePrompt = r;
        });
      });

      const p1 = saveFileAndroid(new Uint8Array([1]), 'concurrent.pdf');

      // Second save attempt while first is waiting for user dialog
      await expect(saveFileAndroid(new Uint8Array([2]), 'concurrent.pdf')).rejects.toThrow(
        'A save operation is already in progress.'
      );

      // Complete first save
      resolvePrompt({ action: 'cancel' });
      const r1 = await p1;
      expect(r1.saved).toBe(false);
    });
  });
});
