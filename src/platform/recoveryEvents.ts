// Framework-agnostic event hooks so native Android SAF save recovery & warnings reach UI reliably.
import type { RecoveryBackupSummary, SaveCleanupWarning } from './types';

export interface RecoveryPromptOptions {
  retrySave?: () => Promise<void>;
}

export type RecoveryHandler = (
  recovery: RecoveryBackupSummary,
  options?: RecoveryPromptOptions,
) => void;

export type CleanupWarningHandler = (warning: SaveCleanupWarning) => void;

export type RepromptNoticeHandler = (message: string) => void;

let activeRecoveryHandler: RecoveryHandler | null = null;
let activeCleanupWarningHandler: CleanupWarningHandler | null = null;
let activeRepromptNoticeHandler: RepromptNoticeHandler | null = null;

export function setRecoveryPromptHandler(handler: RecoveryHandler | null): void {
  activeRecoveryHandler = handler;
}

export function notifyRecoveryRequired(
  recovery: RecoveryBackupSummary,
  options?: RecoveryPromptOptions,
): boolean {
  if (!activeRecoveryHandler) {
    return false;
  }
  activeRecoveryHandler(recovery, options);
  return true;
}

export function setCleanupWarningHandler(handler: CleanupWarningHandler | null): void {
  activeCleanupWarningHandler = handler;
}

export function notifySaveCleanupWarning(warning: SaveCleanupWarning): boolean {
  if (!activeCleanupWarningHandler) {
    return false;
  }
  activeCleanupWarningHandler(warning);
  return true;
}

export function setRepromptNoticeHandler(handler: RepromptNoticeHandler | null): void {
  activeRepromptNoticeHandler = handler;
}

export function notifyDestinationReprompt(message: string): boolean {
  if (!activeRepromptNoticeHandler) {
    return false;
  }
  activeRepromptNoticeHandler(message);
  return true;
}
