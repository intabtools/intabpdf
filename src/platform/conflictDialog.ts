// Conflict prompt definitions and registration for Android file saving.

export type ConflictAction = 'replace' | 'rename' | 'cancel';

export interface ConflictResolution {
  action: ConflictAction;
  newFileName?: string;
}

export interface ConflictPromptOptions {
  displayPath?: string;
  replaceDisabledReason?: string;
}

export type ConflictPromptHandler = (
  fileName: string,
  suggestedName: string,
  options?: ConflictPromptOptions,
) => Promise<ConflictResolution>;

let activeConflictPromptHandler: ConflictPromptHandler | null = null;

export function setConflictPromptHandler(handler: ConflictPromptHandler | null): void {
  activeConflictPromptHandler = handler;
}

export function getConflictPromptHandler(): ConflictPromptHandler | null {
  return activeConflictPromptHandler;
}
