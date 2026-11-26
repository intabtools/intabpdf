import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AboutPage from '../pages/AboutPage';
import { ShellContext } from './shellContextDef';
import { ToastProvider } from './ToastContext';
import { SaveRecoveryProvider } from './SaveRecoveryDialog';
import { SaveRecoveryContext } from './saveRecoveryContextDef';
import {
  notifyDestinationReprompt,
  notifyRecoveryRequired,
  notifySaveCleanupWarning,
} from '../platform/recoveryEvents';
import type { RecoveryBackupSummary } from '../platform/types';

describe('SaveRecoveryProvider & AboutPage recovery entry points', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sampleRecovery: RecoveryBackupSummary = {
    recoveryId: 'rec_sample_1',
    originalFileName: 'tax-summary.pdf',
    attemptedDestination: 'Documents/InTabPDF',
    explanation: 'Replacement failed and backup was preserved.',
    failureKind: 'replace_write_and_restore_failed',
    createdAtMillis: 1700000000000,
    sizeBytes: 2048,
    status: 'pending_action',
    backupAvailable: true,
  };

  it('does not render recovery UI or Android recovery section on Web/Electron when idle', () => {
    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SaveRecoveryProvider isAndroidOverride={false}>
            <ShellContext.Provider
              value={{ shell: 'web', setShell: () => {}, showAppLayout: true, setShowAppLayout: () => {} }}
            >
              <AboutPage />
            </ShellContext.Provider>
          </SaveRecoveryProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(html).not.toContain('Saved file recovery');
    expect(html).not.toContain('File Recovery &amp; Preserved Backups');
    expect(html).not.toContain('Cleanup notice');
  });

  it('renders Android recovery management section on AboutPage when Android platform is active', () => {
    vi.stubGlobal('window', {
      location: { search: '?platform=android' },
    });

    const html = renderToString(
      <MemoryRouter>
        <ShellContext.Provider
          value={{ shell: 'app', setShell: () => {}, showAppLayout: true, setShowAppLayout: () => {} }}
        >
          <SaveRecoveryContext.Provider
            value={{
              backups: [sampleRecovery],
              refreshBackups: async () => [sampleRecovery],
              openRecoveryManager: () => {},
            }}
          >
            <AboutPage />
          </SaveRecoveryContext.Provider>
        </ShellContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Saved file recovery');
    expect(html).toContain('1 preserved recovery backup waiting for export or review.');
    expect(html).toContain('Recover Backups (1)');
  });

  it('hides Android recovery management section on Electron even when SaveRecoveryContext exists', () => {
    vi.stubGlobal('window', {
      location: { search: '?platform=electron' },
    });

    const html = renderToString(
      <MemoryRouter>
        <ShellContext.Provider
          value={{ shell: 'app', setShell: () => {}, showAppLayout: true, setShowAppLayout: () => {} }}
        >
          <SaveRecoveryContext.Provider
            value={{
              backups: [],
              refreshBackups: async () => [],
              openRecoveryManager: () => {},
            }}
          >
            <AboutPage />
          </SaveRecoveryContext.Provider>
        </ShellContext.Provider>
      </MemoryRouter>,
    );

    expect(html).not.toContain('Saved file recovery');
  });

  it('event bridge safely ignores notifications when no handler is registered', () => {
    expect(notifyRecoveryRequired(sampleRecovery)).toBe(false);
    expect(
      notifySaveCleanupWarning({
        code: 'BACKUP_DELETE_FAILED',
        message: 'Saved cleanly, extra backup kept.',
        leftoverFileName: 'intabpdf_bak_test.pdf',
      }),
    ).toBe(false);
    expect(notifyDestinationReprompt('Please pick a writable folder.')).toBe(false);
  });

  it('renders missing backup entry with actionable warning and explicit dismissal instead of trapping user', () => {
    const missingRecord: RecoveryBackupSummary = {
      ...sampleRecovery,
      recoveryId: 'rec_missing_1',
      backupAvailable: false,
      safBackupAvailable: false,
      recoverySource: 'unavailable',
      safBackupDocumentName: 'intabpdf_bak_123_tax-summary.pdf',
    };

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SaveRecoveryProvider
            isAndroidOverride={true}
            initialDialogOpen={true}
            initialBackups={[missingRecord]}
          >
            <div />
          </SaveRecoveryProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(html).toContain('Backup unavailable');
    expect(html).toContain('local recovery copy is unavailable');
    expect(html).toContain('intabpdf_bak_123_tax-summary.pdf');
    expect(html).toContain('Dismiss Unavailable Entry');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Recover Original File/s);
  });

  it('renders SAF-only and orphaned recovery entries accurately and disables all entries while busy', () => {
    const safOnlyRecord: RecoveryBackupSummary = {
      ...sampleRecovery,
      recoveryId: 'rec_saf_1',
      originalFileName: 'SafDoc.pdf',
      backupAvailable: true,
      safBackupAvailable: true,
      recoverySource: 'saf',
      safBackupDocumentName: 'intabpdf_bak_saf_1.pdf',
    };
    const orphanRecord: RecoveryBackupSummary = {
      recoveryId: 'rec_orphan_1',
      originalFileName: 'Unidentified backup (rec_orphan_1.bin)',
      attemptedDestination: 'Unknown (metadata unavailable)',
      explanation: 'Unindexed recovery backup discovered on disk.',
      failureKind: 'orphaned_backup',
      createdAtMillis: 0,
      sizeBytes: 512,
      status: 'pending_action',
      backupAvailable: true,
      recoverySource: 'local',
    };

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SaveRecoveryProvider
            isAndroidOverride={true}
            initialDialogOpen={true}
            initialBackups={[safOnlyRecord, orphanRecord]}
            initialBusyId="rec_saf_1"
          >
            <div />
          </SaveRecoveryProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(html).toContain('SAF folder backup available');
    expect(html).toContain('Opening picker…');
    expect(html).toContain('Orphaned backup — export available');
    expect(html).toContain('Unknown (metadata unavailable)');
    // Both entries' primary buttons must be disabled while rec_saf_1 is busy
    const disabledButtons = html.match(/disabled=""/g) ?? [];
    expect(disabledButtons.length).toBeGreaterThanOrEqual(2);
  });
});
