// Persistent recovery dialog and dismissible SAF cleanup warning surface for Android.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import ModalDialog from './ModalDialog';
import NoticeBanner from './NoticeBanner';
import { SaveRecoveryContext } from './saveRecoveryContextDef';
import { useToast } from '../hooks/useToast';
import { getPlatformType } from '../platform';
import {
  cleanupAndroidLeftoverSafFile,
  confirmDeleteAndroidRecoveryBackup,
  exportAndroidRecoveryBackup,
  listAndroidRecoveryBackups,
  type DocumentSavePlugin,
} from '../platform/androidSave';
import {
  setCleanupWarningHandler,
  setRecoveryPromptHandler,
  setRepromptNoticeHandler,
} from '../platform/recoveryEvents';
import type { RecoveryBackupSummary, SaveCleanupWarning } from '../platform/types';

export interface SaveRecoveryProviderProps {
  children: ReactNode;
  pluginOverride?: DocumentSavePlugin;
  isAndroidOverride?: boolean;
  initialDialogOpen?: boolean;
  initialBackups?: RecoveryBackupSummary[];
  initialBusyId?: string | null;
}

interface ActionFeedback {
  type: 'info' | 'success' | 'warning' | 'danger';
  text: string;
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getStatusLabel(record: RecoveryBackupSummary): string {
  if (!record.backupAvailable) {
    return 'Backup unavailable';
  }
  if (record.status === 'exported_awaiting_delete_confirmation') {
    return 'Exported — awaiting delete confirmation';
  }
  if (record.status === 'delete_failed') {
    return 'Backup preserved — cleanup failed';
  }
  if (record.recoverySource === 'saf') {
    return 'SAF folder backup available';
  }
  if (record.failureKind === 'orphaned_backup') {
    return 'Orphaned backup — export available';
  }
  return 'Recovery required — backup preserved';
}

export function SaveRecoveryProvider({
  children,
  pluginOverride,
  isAndroidOverride,
  initialDialogOpen = false,
  initialBackups = [],
  initialBusyId = null,
}: SaveRecoveryProviderProps): ReactNode {
  const { showToast } = useToast();
  const isAndroid = isAndroidOverride ?? getPlatformType() === 'android';

  const [backups, setBackups] = useState<RecoveryBackupSummary[]>(initialBackups);
  const [isDialogOpen, setIsDialogOpen] = useState(initialDialogOpen);
  const [retrySaveFn, setRetrySaveFn] = useState<(() => Promise<void>) | null>(null);
  const [busyId, setBusyId] = useState<string | null>(initialBusyId);
  const [pendingDeleteConfirmId, setPendingDeleteConfirmId] = useState<string | null>(null);
  const [feedbackById, setFeedbackById] = useState<Record<string, ActionFeedback>>({});

  const [warnings, setWarnings] = useState<SaveCleanupWarning[]>([]);
  const [cleaningWarningIdx, setCleaningWarningIdx] = useState<number | null>(null);
  const [warningNoteByIdx, setWarningNoteByIdx] = useState<Record<number, string>>({});

  const refreshBackups = useCallback(
    async (justReported?: RecoveryBackupSummary): Promise<RecoveryBackupSummary[]> => {
      if (!isAndroid) {
        setBackups([]);
        return [];
      }
      try {
        const list = await listAndroidRecoveryBackups(pluginOverride);
        if (justReported && !list.some((item) => item.recoveryId === justReported.recoveryId)) {
          const merged = [justReported, ...list];
          setBackups(merged);
          return merged;
        }
        setBackups(list);
        return list;
      } catch {
        return [];
      }
    },
    [isAndroid, pluginOverride],
  );

  const openRecoveryManager = useCallback(
    (options?: { retrySave?: () => Promise<void> }) => {
      setRetrySaveFn(() => options?.retrySave ?? null);
      setPendingDeleteConfirmId(null);
      setIsDialogOpen(true);
      void refreshBackups();
    },
    [refreshBackups],
  );

  const attachRetrySave = useCallback((retrySave: (() => Promise<void>) | null) => {
    setRetrySaveFn(() => retrySave);
  }, []);

  useEffect(() => {
    if (!isAndroid) return;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const rafId = window.requestAnimationFrame(() => {
        void refreshBackups();
      });
      return () => {
        window.cancelAnimationFrame(rafId);
      };
    }
    void refreshBackups();
    return undefined;
  }, [isAndroid, refreshBackups]);

  useEffect(() => {
    setRecoveryPromptHandler((recovery, options) => {
      setBackups((prev) => [recovery, ...prev.filter((item) => item.recoveryId !== recovery.recoveryId)]);
      if (options?.retrySave) {
        setRetrySaveFn(() => options.retrySave!);
      }
      setPendingDeleteConfirmId(null);
      setIsDialogOpen(true);
      void refreshBackups(recovery);
    });

    setCleanupWarningHandler((warning) => {
      setWarnings((prev) => {
        const exists = prev.some(
          (w) =>
            w.message === warning.message &&
            w.leftoverDocumentUri === warning.leftoverDocumentUri,
        );
        return exists ? prev : [...prev, warning];
      });
    });

    setRepromptNoticeHandler((msg) => {
      showToast(msg, 3500);
    });

    return () => {
      setRecoveryPromptHandler(null);
      setCleanupWarningHandler(null);
      setRepromptNoticeHandler(null);
    };
  }, [refreshBackups, showToast]);

  const handleExport = async (record: RecoveryBackupSummary) => {
    if (busyId) return;
    setBusyId(record.recoveryId);
    setPendingDeleteConfirmId(null);
    try {
      const res = await exportAndroidRecoveryBackup(record.recoveryId, pluginOverride);
      if (res.status === 'exported') {
        setBackups((prev) =>
          prev.map((item) =>
            item.recoveryId === record.recoveryId
              ? {
                  ...item,
                  status: 'exported_awaiting_delete_confirmation',
                  exportedFileName: res.exportedFileName,
                  backupAvailable: true,
                }
              : item,
          ),
        );
        setFeedbackById((prev) => ({
          ...prev,
          [record.recoveryId]: {
            type: 'success',
            text: `Recovery export succeeded (${res.exportedFileName}). Confirm deletion below only after verifying the exported file.`,
          },
        }));
        setPendingDeleteConfirmId(record.recoveryId);
      } else if (res.status === 'cancelled') {
        setFeedbackById((prev) => ({
          ...prev,
          [record.recoveryId]: {
            type: 'info',
            text: 'Export cancelled. Your backup remains safely preserved.',
          },
        }));
      } else {
        setFeedbackById((prev) => ({
          ...prev,
          [record.recoveryId]: {
            type: 'danger',
            text: `Export failed: ${res.errorMessage}. The backup remains preserved so you can try again.`,
          },
        }));
      }
      await refreshBackups();
    } catch (err) {
      const msg = err instanceof Error && err.message.trim() ? err.message : 'Unexpected export error';
      setFeedbackById((prev) => ({
        ...prev,
        [record.recoveryId]: {
          type: 'danger',
          text: `Export failed: ${msg}. The backup remains preserved.`,
        },
      }));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async (record: RecoveryBackupSummary) => {
    if (busyId) return;
    setBusyId(record.recoveryId);
    try {
      const res = await confirmDeleteAndroidRecoveryBackup(record.recoveryId, pluginOverride);
      if (res.status === 'deleted') {
        setPendingDeleteConfirmId(null);
        setBackups((prev) => prev.filter((item) => item.recoveryId !== record.recoveryId));
        setFeedbackById((prev) => {
          const next = { ...prev };
          delete next[record.recoveryId];
          return next;
        });
      } else {
        setPendingDeleteConfirmId(null);
        setBackups((prev) =>
          prev.map((item) =>
            item.recoveryId === record.recoveryId
              ? { ...item, status: 'delete_failed', backupAvailable: res.backupPreserved }
              : item,
          ),
        );
        setFeedbackById((prev) => ({
          ...prev,
          [record.recoveryId]: {
            type: 'warning',
            text: res.errorMessage,
          },
        }));
      }
      await refreshBackups();
    } catch (err) {
      const msg = err instanceof Error && err.message.trim() ? err.message : 'Could not remove backup copy';
      setFeedbackById((prev) => ({
        ...prev,
        [record.recoveryId]: {
          type: 'warning',
          text: msg,
        },
      }));
    } finally {
      setBusyId(null);
    }
  };

  const handleDismissWarning = (index: number) => {
    setWarnings((prev) => prev.filter((_, idx) => idx !== index));
    setWarningNoteByIdx((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k);
        if (idx < index) next[idx] = v;
        if (idx > index) next[idx - 1] = v;
      });
      return next;
    });
  };

  const handleSafeCleanupWarning = async (index: number, warning: SaveCleanupWarning) => {
    if (!warning.leftoverDocumentUri || cleaningWarningIdx !== null) return;
    setCleaningWarningIdx(index);
    try {
      const res = await cleanupAndroidLeftoverSafFile(
        {
          leftoverDocumentUri: warning.leftoverDocumentUri,
          verifiedTargetUri: warning.verifiedTargetUri,
          expectedSizeBytes: warning.expectedSizeBytes,
        },
        pluginOverride,
      );
      if (res.status === 'removed') {
        handleDismissWarning(index);
        showToast(`Removed extra backup file ${res.leftoverFileName}`);
      } else {
        setWarningNoteByIdx((prev) => ({
          ...prev,
          [index]: res.errorMessage,
        }));
      }
    } catch (err) {
      setWarningNoteByIdx((prev) => ({
        ...prev,
        [index]: err instanceof Error && err.message.trim() ? err.message : 'Cleanup could not be completed.',
      }));
    } finally {
      setCleaningWarningIdx(null);
    }
  };

  const handleRetrySave = () => {
    const fn = retrySaveFn;
    setIsDialogOpen(false);
    setRetrySaveFn(null);
    if (fn) {
      void fn();
    }
  };

  const handleCloseDialog = () => {
    setPendingDeleteConfirmId(null);
    setRetrySaveFn(null);
    setIsDialogOpen(false);
  };

  return (
    <SaveRecoveryContext.Provider value={{ backups, refreshBackups, openRecoveryManager, attachRetrySave }}>
      {children}

      {warnings.length > 0 && (
        <div
          aria-label="File save cleanup notices"
          style={{
            position: 'fixed',
            left: '16px',
            right: '16px',
            bottom: '76px',
            zIndex: 950,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: '560px',
            margin: '0 auto',
          }}
        >
          {warnings.map((warning, idx) => (
            <NoticeBanner
              key={`${warning.code}-${warning.leftoverFileName || idx}`}
              variant="warning"
              role="status"
              title="Cleanup notice"
              onDismiss={() => handleDismissWarning(idx)}
              dismissLabel="Dismiss cleanup notice"
              style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span>{warning.message}</span>
                {warning.leftoverFileName && (
                  <small style={{ opacity: 0.9 }}>
                    Extra file kept in folder: <strong>{warning.leftoverFileName}</strong>
                  </small>
                )}
                {warningNoteByIdx[idx] && (
                  <small style={{ color: 'var(--danger)' }}>{warningNoteByIdx[idx]}</small>
                )}
                {warning.leftoverDocumentUri && warning.verifiedTargetUri && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={cleaningWarningIdx === idx}
                      onClick={() => void handleSafeCleanupWarning(idx, warning)}
                    >
                      <Trash2 size={14} />
                      <span>
                        {cleaningWarningIdx === idx ? 'Checking & removing…' : 'Verify & remove extra backup'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </NoticeBanner>
          ))}
        </div>
      )}

      {isDialogOpen && (
        <ModalDialog
          isOpen={true}
          onClose={handleCloseDialog}
          title="File Recovery & Preserved Backups"
          titleId="save-recovery-dialog-title"
          icon={<ShieldAlert size={20} color="var(--danger)" />}
          description="When a file replacement fails and cannot automatically restore, InTabPDF keeps your previous file in app recovery storage until you export and confirm removal."
          dismissOnEscape={false}
          dismissOnBackdrop={false}
          closeLabel="Close recovery dialog"
          maxWidth="520px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '62vh', overflowY: 'auto' }}>
            {backups.length === 0 ? (
              <NoticeBanner variant="info" role="status">
                No preserved recovery backups are currently pending.
              </NoticeBanner>
            ) : (
              backups.map((record) => {
                const isBusy = busyId === record.recoveryId;
                const anyBusy = busyId !== null;
                const feedback = feedbackById[record.recoveryId];
                const awaitingDeleteConfirm = pendingDeleteConfirmId === record.recoveryId;
                const canDeleteOrDismiss =
                  !record.backupAvailable ||
                  record.status === 'exported_awaiting_delete_confirmation' ||
                  record.status === 'delete_failed';
                const badgeBg = !record.backupAvailable
                  ? 'rgba(239,68,68,0.14)'
                  : record.status === 'exported_awaiting_delete_confirmation'
                    ? 'rgba(34,197,94,0.14)'
                    : 'rgba(245,158,11,0.16)';
                const badgeColor = !record.backupAvailable
                  ? 'var(--danger)'
                  : record.status === 'exported_awaiting_delete_confirmation'
                    ? 'var(--success)'
                    : 'var(--warning)';

                return (
                  <div
                    key={record.recoveryId}
                    data-testid={`recovery-item-${record.recoveryId}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-2)',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <strong style={{ fontSize: '14px', wordBreak: 'break-all' }}>{record.originalFileName}</strong>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: badgeBg,
                          color: badgeColor,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {getStatusLabel(record)}
                      </span>
                    </div>

                    <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span>{record.explanation}</span>
                      <span>
                        Attempted destination: <strong>{record.attemptedDestination || 'Unknown (metadata unavailable)'}</strong> • {formatByteSize(record.sizeBytes)}
                      </span>
                      {record.createdAtMillis > 0 && (
                        <span>
                          Preserved: {new Date(record.createdAtMillis).toLocaleString()}
                        </span>
                      )}
                      {record.safBackupDocumentName && (
                        <span>
                          Folder backup copy: <strong>{record.safBackupDocumentName}</strong>
                          {record.recoverySource === 'saf' ? ' (accessible via SAF)' : ''}
                        </span>
                      )}
                      {record.exportedFileName && (
                        <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={13} />
                          Last exported as <strong>{record.exportedFileName}</strong>
                        </span>
                      )}
                    </div>

                    {!record.backupAvailable && (
                      <NoticeBanner variant="warning" role="status">
                        {record.safBackupDocumentName
                          ? `The local recovery copy is unavailable and SAF access to "${record.safBackupDocumentName}" could not be verified (permission may have been revoked or the file was moved). Check ${record.attemptedDestination || 'your chosen folder'} in your device Files app before dismissing this entry.`
                          : 'The preserved recovery backup file is missing or unreadable in app storage and can no longer be exported. You can dismiss this unavailable entry below.'}
                      </NoticeBanner>
                    )}

                    {feedback && (
                      <NoticeBanner variant={feedback.type} role={feedback.type === 'danger' ? 'alert' : 'status'}>
                        {feedback.text}
                      </NoticeBanner>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '2px' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={anyBusy || !record.backupAvailable}
                        onClick={() => void handleExport(record)}
                      >
                        <Download size={14} />
                        <span>
                          {isBusy
                            ? 'Opening picker…'
                            : record.status === 'exported_awaiting_delete_confirmation'
                              ? 'Export Again'
                              : record.recoverySource === 'saf'
                                ? 'Export SAF Backup'
                                : 'Recover Original File'}
                        </span>
                      </button>

                      {canDeleteOrDismiss && !awaitingDeleteConfirm && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={anyBusy}
                          onClick={() => setPendingDeleteConfirmId(record.recoveryId)}
                        >
                          <Trash2 size={14} />
                          <span>{!record.backupAvailable ? 'Dismiss Unavailable Entry' : 'Delete App Backup'}</span>
                        </button>
                      )}
                    </div>

                    {awaitingDeleteConfirm && (
                      <div
                        style={{
                          marginTop: '4px',
                          padding: '10px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--warning)',
                          background: 'var(--surface)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <span style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <AlertTriangle size={14} color="var(--warning)" />
                          <span>
                            {!record.backupAvailable
                              ? `Confirm dismissing this unavailable recovery entry${record.safBackupDocumentName ? ` (does not delete "${record.safBackupDocumentName}" from your device folder)` : ''}?`
                              : `Confirm deleting the app backup copy? Only remove it after verifying your exported file${record.exportedFileName ? ` (${record.exportedFileName})` : ''}.`}
                          </span>
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn btn-danger-soft btn-sm"
                            disabled={anyBusy}
                            onClick={() => void handleConfirmDelete(record)}
                          >
                            {!record.backupAvailable ? 'Confirm Dismiss Entry' : 'Confirm Delete Backup'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={anyBusy}
                            onClick={() => setPendingDeleteConfirmId(null)}
                          >
                            Keep Entry
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
            {retrySaveFn && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRetrySave}
              >
                <RefreshCw size={15} />
                <span>Retry Save</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCloseDialog}
            >
              Close (Keep Backups)
            </button>
          </div>
        </ModalDialog>
      )}
    </SaveRecoveryContext.Provider>
  );
}
