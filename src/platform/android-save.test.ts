import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupAndroidLeftoverSafFile,
  confirmDeleteAndroidRecoveryBackup,
  exportAndroidRecoveryBackup,
  listAndroidRecoveryBackups,
  saveFileAndroid,
  splitFileName,
  suggestUniqueFileName,
  type DocumentSavePlugin,
} from './androidSave';
import { setConflictPromptHandler, type ConflictResolution } from './conflictDialog';
import {
  setCleanupWarningHandler,
  setRecoveryPromptHandler,
  setRepromptNoticeHandler,
} from './recoveryEvents';
import type { RecoveryBackupSummary, SaveCleanupWarning } from './types';

const shareMock = vi.fn();

vi.mock('@capacitor/share', () => ({
  Share: {
    canShare: vi.fn(async () => ({ value: true })),
    share: shareMock,
  },
}));

describe('Android SAF file saving, recovery hardening, and conflict protection', () => {
  let safFiles: Map<string, { data: string; flags: 'full' | 'wt_only' | 'read_only' }>;
  let folderCancelled = false;
  let needsReselectOnce = false;
  let readOnlyRepromptOnce = false;
  let injectRecoveryFailure = false;
  let injectSafOnlyRecoveryFailure = false;
  let injectUnavailableRecoveryFailure = false;
  let injectRolledBackFailure = false;
  let injectBackupCleanupWarning = false;

  const createMockPlugin = (): DocumentSavePlugin => ({
    prepareSaveDestination: vi.fn(async () => {
      if (folderCancelled) {
        return { ready: false, cancelled: true };
      }
      if (readOnlyRepromptOnce) {
        readOnlyRepromptOnce = false;
        return {
          ready: false,
          cancelled: false,
          reprompt: true,
          reason: 'The selected folder only granted read access. Please choose a writable folder.',
        };
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

      if (injectRecoveryFailure && replaceExisting) {
        injectRecoveryFailure = false;
        return {
          status: 'recovery_failed' as const,
          recoveryId: 'rec_1234',
          originalFileName: fileName,
          attemptedDestination: 'Documents/InTabPDF',
          explanation: `Replacement failed for ${fileName}; backup preserved.`,
          failureKind: 'replace_write_and_restore_failed',
          backupAvailable: true,
          safBackupAvailable: false,
          recoverySource: 'local' as const,
          createdAtMillis: 1700000000000,
          sizeBytes: 256,
        };
      }

      if (injectSafOnlyRecoveryFailure && replaceExisting) {
        injectSafOnlyRecoveryFailure = false;
        return {
          status: 'recovery_failed' as const,
          recoveryId: 'rec_saf_only',
          originalFileName: fileName,
          attemptedDestination: 'Documents/InTabPDF',
          explanation: `Local copy failed, but SAF backup remains accessible for ${fileName}.`,
          failureKind: 'swap_and_rollback_failed',
          backupAvailable: true,
          safBackupAvailable: true,
          recoverySource: 'saf' as const,
          safBackupDocumentName: `intabpdf_bak_1_${fileName}`,
          createdAtMillis: 1700000000000,
          sizeBytes: 256,
        };
      }

      if (injectUnavailableRecoveryFailure && replaceExisting) {
        injectUnavailableRecoveryFailure = false;
        return {
          status: 'recovery_failed' as const,
          recoveryId: 'rec_unavail',
          originalFileName: fileName,
          attemptedDestination: 'Documents/InTabPDF',
          explanation: `Replacement failed and recovery could not be verified for ${fileName}.`,
          failureKind: 'swap_and_rollback_failed',
          backupAvailable: false,
          safBackupAvailable: false,
          recoverySource: 'unavailable' as const,
          safBackupDocumentName: `intabpdf_bak_2_${fileName}`,
          createdAtMillis: 1700000000000,
          sizeBytes: 256,
        };
      }

      if (injectRolledBackFailure && replaceExisting) {
        injectRolledBackFailure = false;
        return {
          status: 'failed' as const,
          code: 'REPLACE_ROLLED_BACK',
          errorMessage: 'Replacement failed; original file was restored safely.',
          originalIntact: true,
        };
      }

      const matchedKey = Array.from(safFiles.keys()).find(
        (key) => key.toLowerCase() === fileName.toLowerCase(),
      );
      const existingEntry = matchedKey ? safFiles.get(matchedKey) : undefined;
      if (existingEntry && matchedKey) {
        if (!replaceExisting) {
          const suggested = await suggestUniqueFileName(matchedKey, (n) =>
            Array.from(safFiles.keys()).some((k) => k.toLowerCase() === n.toLowerCase()),
          );
          return {
            status: 'conflict' as const,
            existingFileName: matchedKey,
            suggestedFileName: suggested,
          };
        }
        if (existingEntry.flags === 'read_only') {
          const suggested = await suggestUniqueFileName(matchedKey, (n) =>
            Array.from(safFiles.keys()).some((k) => k.toLowerCase() === n.toLowerCase()),
          );
          return {
            status: 'replace_unsupported' as const,
            existingFileName: matchedKey,
            suggestedFileName: suggested,
            reason: 'This storage provider does not allow safe replacement. Original file was kept untouched.',
          };
        }
      }

      const finalName = matchedKey || fileName;
      safFiles.set(finalName, { data: base64Data, flags: 'full' });
      const cleanupWarning = injectBackupCleanupWarning
        ? {
            code: 'BACKUP_DELETE_FAILED',
            message: `${finalName} was saved to Documents/InTabPDF, but extra backup intabpdf_bak_${finalName} could not be removed automatically.`,
            leftoverFileName: `intabpdf_bak_${finalName}`,
            leftoverDocumentUri: `content://mock/bak/${finalName}`,
            verifiedTargetUri: `content://mock/target/${finalName}`,
            expectedSizeBytes: base64Data.length,
          }
        : undefined;

      return {
        status: 'saved' as const,
        fileName: finalName,
        displayPath: 'Documents/InTabPDF',
        documentUri: `content://com.android.externalstorage.documents/document/${encodeURIComponent(finalName)}`,
        bytesWritten: base64Data.length,
        replaced: Boolean(existingEntry),
        cleanupWarning,
      };
    }),

    listRecoveryBackups: vi.fn(async () => ({ backups: [] })),
    exportRecoveryBackup: vi.fn(async ({ recoveryId }) => ({
      status: 'exported' as const,
      recoveryId,
      exportedFileName: 'recovered.pdf',
      exportedUri: 'content://exported/recovered.pdf',
      bytesWritten: 256,
      backupPreserved: true,
      awaitingDeleteConfirmation: true,
    })),
    confirmDeleteRecoveryBackup: vi.fn(async ({ recoveryId }) => ({
      status: 'deleted' as const,
      recoveryId,
    })),
    cleanupLeftoverSafFile: vi.fn(async () => ({
      status: 'removed' as const,
      leftoverFileName: 'intabpdf_bak_test.pdf',
    })),
  });

  beforeEach(() => {
    safFiles = new Map();
    folderCancelled = false;
    needsReselectOnce = false;
    readOnlyRepromptOnce = false;
    injectRecoveryFailure = false;
    injectSafOnlyRecoveryFailure = false;
    injectUnavailableRecoveryFailure = false;
    injectRolledBackFailure = false;
    injectBackupCleanupWarning = false;
    shareMock.mockClear();
    setConflictPromptHandler(null);
    setRecoveryPromptHandler(null);
    setCleanupWarningHandler(null);
    setRepromptNoticeHandler(null);
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

  describe('saveFileAndroid SAF workflow & recovery notifications', () => {
    it('saves directly into Documents/InTabPDF with unambiguous outcome status and zero warnings', async () => {
      const recoverySpy = vi.fn();
      const warningSpy = vi.fn();
      setRecoveryPromptHandler(recoverySpy);
      setCleanupWarningHandler(warningSpy);

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([1, 2, 3, 4]), 'new-file.pdf', 'application/pdf', plugin);

      expect(result).toEqual({
        saved: true,
        outcome: 'saved',
        fileName: 'new-file.pdf',
        displayPath: 'Documents/InTabPDF',
        cleanupWarning: undefined,
      });
      expect(safFiles.has('new-file.pdf')).toBe(true);
      expect(shareMock).not.toHaveBeenCalled();
      expect(recoverySpy).not.toHaveBeenCalled();
      expect(warningSpy).not.toHaveBeenCalled();
    });

    it('returns saved=false outcome=cancelled cleanly on picker cancel', async () => {
      folderCancelled = true;
      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([1, 2, 3]), 'report.pdf', 'application/pdf', plugin);

      expect(result).toEqual({ saved: false, outcome: 'cancelled' });
      expect(safFiles.size).toBe(0);
    });

    it('surfaces read-only reprompt notice and prompts user again', async () => {
      readOnlyRepromptOnce = true;
      const notices: string[] = [];
      setRepromptNoticeHandler((m) => notices.push(m));

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([4, 5]), 'writable.pdf', 'application/pdf', plugin);
      expect(result.saved).toBe(true);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('read access');
      expect(plugin.prepareSaveDestination).toHaveBeenCalledTimes(2);
    });

    it('returns outcome=replaced and surfaces non-blocking cleanupWarning when leftover backup delete fails', async () => {
      safFiles.set('target.pdf', { data: 'b2xk', flags: 'full' });
      injectBackupCleanupWarning = true;
      setConflictPromptHandler(async () => ({ action: 'replace' }));

      const seenWarnings: SaveCleanupWarning[] = [];
      setCleanupWarningHandler((w) => seenWarnings.push(w));

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([8, 8, 8]), 'target.pdf', 'application/pdf', plugin);
      expect(result.saved).toBe(true);
      expect(result.outcome).toBe('replaced');
      expect(seenWarnings).toHaveLength(1);
      expect(seenWarnings[0].code).toBe('BACKUP_DELETE_FAILED');
      expect(seenWarnings[0].leftoverFileName).toBe('intabpdf_bak_target.pdf');
    });

    it('returns structured failed_recovery_available without claiming saved and notifies recovery UI', async () => {
      safFiles.set('critical.pdf', { data: 'b2xk', flags: 'full' });
      injectRecoveryFailure = true;
      setConflictPromptHandler(async () => ({ action: 'replace' }));

      const receivedRecovery: RecoveryBackupSummary[] = [];
      setRecoveryPromptHandler((rec) => receivedRecovery.push(rec));

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([7, 7]), 'critical.pdf', 'application/pdf', plugin);

      expect(result.saved).toBe(false);
      expect(result.outcome).toBe('failed_recovery_available');
      expect(result.originalIntact).toBe(false);
      expect(result.recovery?.recoveryId).toBe('rec_1234');
      expect(result.recovery?.backupAvailable).toBe(true);
      expect(receivedRecovery).toHaveLength(1);
    });

    it('returns failed_original_intact cleanly when replacement rolls back', async () => {
      safFiles.set('contract.pdf', { data: 'b3JpZ2luYWw=', flags: 'full' });
      injectRolledBackFailure = true;
      setConflictPromptHandler(async () => ({ action: 'replace' }));

      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([6, 6]), 'contract.pdf', 'application/pdf', plugin);

      expect(result.saved).toBe(false);
      expect(result.outcome).toBe('failed_original_intact');
      expect(result.originalIntact).toBe(true);
      expect(result.message).toContain('restored safely');
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
      expect(result).toEqual({ saved: false, outcome: 'cancelled' });
      expect(safFiles.get('existing.pdf')?.data).toBe('b3JpZ2luYWw=');
    });

    it('handles replace_unsupported and preserves extension on Save as New Copy', async () => {
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
        outcome: 'saved',
        fileName: 'locked-copy.pdf',
        displayPath: 'Documents/InTabPDF',
        cleanupWarning: undefined,
      });
      expect(seenPrompts).toHaveLength(2);
      expect(seenPrompts[1].replaceDisabledReason).toContain('Original file was kept untouched');
      expect(safFiles.get('locked.pdf')?.data).toBe('bG9ja2Vk');
      expect(safFiles.has('locked-copy.pdf')).toBe(true);
    });

    it('re-prompts if user enters a custom name that collides case-insensitively', async () => {
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

    it('re-prompts destination selection if persisted access was revoked before write', async () => {
      needsReselectOnce = true;
      const plugin = createMockPlugin();
      const result = await saveFileAndroid(new Uint8Array([4, 5, 6]), 'reselect.pdf', 'application/pdf', plugin);

      expect(result.saved).toBe(true);
      expect(plugin.prepareSaveDestination).toHaveBeenCalledTimes(2);
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
      expect(await p1).toEqual({ saved: false, outcome: 'cancelled' });
    });

    it('exposes list, export, confirm delete, and safe leftover cleanup wrappers cleanly', async () => {
      const plugin = createMockPlugin();
      expect(await listAndroidRecoveryBackups(plugin)).toEqual([]);
      expect(await exportAndroidRecoveryBackup('rec_1', plugin)).toMatchObject({
        status: 'exported',
        backupPreserved: true,
        awaitingDeleteConfirmation: true,
      });
      expect(await confirmDeleteAndroidRecoveryBackup('rec_1', plugin)).toEqual({
        status: 'deleted',
        recoveryId: 'rec_1',
      });
      expect(
        await cleanupAndroidLeftoverSafFile(
          { leftoverDocumentUri: 'content://bak', verifiedTargetUri: 'content://target', expectedSizeBytes: 12 },
          plugin,
        ),
      ).toEqual({
        status: 'removed',
        leftoverFileName: 'intabpdf_bak_test.pdf',
      });
    });

    it('propagates SAF-only and unavailable recovery sources accurately with single notification', async () => {
      safFiles.set('safonly.pdf', { data: 'b2xk', flags: 'full' });
      safFiles.set('unavail.pdf', { data: 'b2xk', flags: 'full' });
      setConflictPromptHandler(async () => ({ action: 'replace' }));

      const seen: RecoveryBackupSummary[] = [];
      setRecoveryPromptHandler((rec) => seen.push(rec));

      injectSafOnlyRecoveryFailure = true;
      const plugin = createMockPlugin();
      const safRes = await saveFileAndroid(new Uint8Array([1, 2]), 'safonly.pdf', 'application/pdf', plugin);
      expect(safRes.saved).toBe(false);
      expect(safRes.outcome).toBe('failed_recovery_available');
      expect(safRes.recovery?.recoverySource).toBe('saf');
      expect(safRes.recovery?.safBackupAvailable).toBe(true);
      expect(seen).toHaveLength(1);

      injectUnavailableRecoveryFailure = true;
      const unavailRes = await saveFileAndroid(new Uint8Array([3, 4]), 'unavail.pdf', 'application/pdf', plugin);
      expect(unavailRes.saved).toBe(false);
      expect(unavailRes.recovery?.backupAvailable).toBe(false);
      expect(unavailRes.recovery?.recoverySource).toBe('unavailable');
      expect(seen).toHaveLength(2);
    });

    it('saves ZIP, TXT, PNG, and JPEG mime types without invoking Share sheet', async () => {
      const plugin = createMockPlugin();
      const cases: Array<[string, string]> = [
        ['bundle.zip', 'application/zip'],
        ['notes.txt', 'text/plain;charset=utf-8'],
        ['page-1.png', 'image/png'],
        ['scan.jpg', 'image/jpeg'],
      ];
      for (const [name, mime] of cases) {
        const res = await saveFileAndroid(new Uint8Array([10, 20]), name, mime, plugin);
        expect(res.saved).toBe(true);
        expect(res.fileName).toBe(name);
      }
      expect(shareMock).not.toHaveBeenCalled();
    });
  });
});
