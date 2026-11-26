import { createContext } from 'react';
import type { RecoveryBackupSummary } from '../platform/types';

export interface SaveRecoveryContextValue {
  backups: RecoveryBackupSummary[];
  refreshBackups: () => Promise<RecoveryBackupSummary[]>;
  openRecoveryManager: (options?: { retrySave?: () => Promise<void> }) => void;
  attachRetrySave?: (retrySave: (() => Promise<void>) | null) => void;
}

export const SaveRecoveryContext = createContext<SaveRecoveryContextValue | null>(null);
