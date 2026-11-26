export interface OpenedFile {
    name: string;
    bytes: Uint8Array;
}

export type PlatformType = 'android' | 'electron' | 'web';

export interface SaveCleanupWarning {
    code: string;
    message: string;
    leftoverFileName?: string;
    leftoverDocumentUri?: string;
    verifiedTargetUri?: string;
    expectedSizeBytes?: number;
}

export type RecoveryFailureKind =
    | 'replace_write_and_restore_failed'
    | 'swap_and_rollback_failed'
    | 'interrupted_replacement'
    | 'orphaned_backup';

export type RecoveryBackupStatus =
    | 'pending_action'
    | 'exported_awaiting_delete_confirmation'
    | 'delete_failed';

export type RecoverySource = 'local' | 'saf' | 'unavailable';

export interface RecoveryBackupSummary {
    recoveryId: string;
    originalFileName: string;
    attemptedDestination: string;
    explanation: string;
    failureKind: RecoveryFailureKind | string;
    createdAtMillis: number;
    sizeBytes: number;
    status: RecoveryBackupStatus;
    safBackupDocumentName?: string;
    exportedFileName?: string;
    backupAvailable: boolean;
    safBackupAvailable?: boolean;
    recoverySource?: RecoverySource;
}

export type SaveOutcomeStatus =
    | 'saved'
    | 'replaced'
    | 'cancelled'
    | 'failed_original_intact'
    | 'failed_recovery_available';

export interface SaveFileResult {
    saved: boolean;
    outcome?: SaveOutcomeStatus;
    fileName?: string;
    displayPath?: string;
    originalIntact?: boolean;
    message?: string;
    cleanupWarning?: SaveCleanupWarning;
    recovery?: RecoveryBackupSummary;
}

export interface PlatformAdapter {
    pickPdfFile(onStart?: (fileName: string) => void): Promise<OpenedFile | null>;
    onFileOpened(handler: (file: OpenedFile) => void): () => void;
    onFileOpenStart?(handler: (fileName: string) => void): () => void;
    onFileOpenError?(handler: (message: string) => void): () => void;
    hasPendingFile?(): boolean;
    clearPendingFile?(): void;
    saveFile?(bytes: Uint8Array, fileName: string, mimeType?: string): Promise<SaveFileResult | void>;
}
