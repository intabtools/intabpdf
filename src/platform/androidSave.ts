// Safe SAF-based file saving and conflict protection for Android.
import { registerPlugin } from '@capacitor/core';
import { getConflictPromptHandler, type ConflictPromptOptions } from './conflictDialog';
import { uint8ArrayToBase64 } from './index';

export interface PrepareSaveDestinationResult {
  ready: boolean;
  cancelled?: boolean;
  folderUri?: string;
  displayPath?: string;
  existingNames?: string[];
}

export interface WriteToDestinationOptions {
  fileName: string;
  mimeType: string;
  base64Data: string;
  replaceExisting: boolean;
}

export type WriteToDestinationResult =
  | {
      status: 'saved';
      fileName: string;
      displayPath?: string;
      documentUri?: string;
      bytesWritten?: number;
      replaced?: boolean;
      warning?: string;
    }
  | { status: 'needs_folder_selection' }
  | { status: 'conflict'; existingFileName: string; suggestedFileName: string }
  | { status: 'replace_unsupported'; existingFileName: string; suggestedFileName: string; reason: string };

export interface DocumentSavePlugin {
  prepareSaveDestination(): Promise<PrepareSaveDestinationResult>;
  writeToDestination(options: WriteToDestinationOptions): Promise<WriteToDestinationResult>;
}

const DocumentSave = registerPlugin<DocumentSavePlugin>('DocumentSave');

let isSaveInProgress = false;

export function splitFileName(fileName: string): { base: string; ext: string } {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) {
    return { base: fileName, ext: '' };
  }
  return {
    base: fileName.slice(0, lastDot),
    ext: fileName.slice(lastDot),
  };
}

/**
 * Generates an automatically suggested unique filename when a destination file exists,
 * e.g., "document.pdf" -> "document (1).pdf", handling existing numeric suffixes.
 */
export async function suggestUniqueFileName(
  fileName: string,
  checkExists: (name: string) => Promise<boolean> | boolean,
): Promise<string> {
  const { base, ext } = splitFileName(fileName);
  const suffixMatch = base.match(/^(.*?)\s*\((\d+)\)$/);
  let cleanBase = base;
  let nextCounter = 1;

  if (suffixMatch) {
    cleanBase = suffixMatch[1].trim();
    nextCounter = parseInt(suffixMatch[2], 10) + 1;
  }

  for (let counter = nextCounter; counter < nextCounter + 1000; counter++) {
    const candidate = `${cleanBase} (${counter})${ext}`;
    const exists = await checkExists(candidate);
    if (!exists) {
      return candidate;
    }
  }

  return `${cleanBase} (${Date.now()})${ext}`;
}

function appendOriginalExtensionIfMissing(chosenName: string, originalFileName: string): string {
  const { ext: originalExt } = splitFileName(originalFileName);
  const { ext: chosenExt } = splitFileName(chosenName);
  if (originalExt && chosenExt.toLowerCase() !== originalExt.toLowerCase()) {
    return `${chosenName}${originalExt}`;
  }
  return chosenName;
}

function findCollisionCaseInsensitive(existingNames: string[], candidateName: string): string | undefined {
  const targetLower = candidateName.toLowerCase();
  return (
    existingNames.find((name) => name === candidateName) ??
    existingNames.find((name) => name.toLowerCase() === targetLower)
  );
}

async function promptConflictOrThrow(
  existingName: string,
  suggestedName: string,
  options?: ConflictPromptOptions,
) {
  const promptHandler = getConflictPromptHandler();
  if (!promptHandler) {
    throw new Error('Filename conflict detected but no resolution dialog handler is available.');
  }
  return promptHandler(existingName, suggestedName, options);
}

export interface AndroidSaveResult {
  saved: boolean;
  fileName?: string;
  displayPath?: string;
}

/**
 * Saves a generated document into Android's SAF-granted Documents/InTabPDF/ folder without
 * invoking the Share sheet or touching legacy File APIs in public shared storage.
 */
export async function saveFileAndroid(
  bytes: Uint8Array,
  initialFileName: string,
  mimeType = 'application/pdf',
  plugin: DocumentSavePlugin = DocumentSave,
): Promise<AndroidSaveResult> {
  if (isSaveInProgress) {
    throw new Error('A save operation is already in progress.');
  }
  if (!bytes || bytes.byteLength === 0) {
    throw new Error('Cannot save an empty file.');
  }

  isSaveInProgress = true;
  try {
    const base64Data = uint8ArrayToBase64(bytes);
    let targetFileName = initialFileName;
    let replaceExisting = false;
    let forcedReplaceUnsupportedReason: string | undefined;

    for (let attempt = 0; attempt < 6; attempt++) {
      const prep = await plugin.prepareSaveDestination();
      if (prep.cancelled) {
        return { saved: false };
      }
      if (!prep.ready) {
        throw new Error('Could not prepare the Android destination folder.');
      }

      const displayPath = prep.displayPath || 'Documents/InTabPDF';
      const existingNames = prep.existingNames ?? [];

      // Resolve any pre-existing collision before transferring bytes across the bridge
      while (true) {
        const matchedExisting = findCollisionCaseInsensitive(existingNames, targetFileName);
        if (!matchedExisting && !forcedReplaceUnsupportedReason) {
          break;
        }
        if (replaceExisting && !forcedReplaceUnsupportedReason) {
          break;
        }

        const conflictName = matchedExisting || targetFileName;
        const suggestedName = await suggestUniqueFileName(conflictName, (candidate) =>
          Boolean(findCollisionCaseInsensitive(existingNames, candidate)),
        );

        const resolution = await promptConflictOrThrow(conflictName, suggestedName, {
          displayPath,
          replaceDisabledReason: forcedReplaceUnsupportedReason,
        });
        forcedReplaceUnsupportedReason = undefined;

        if (resolution.action === 'cancel') {
          return { saved: false };
        }

        if (resolution.action === 'replace') {
          replaceExisting = true;
          targetFileName = conflictName;
          break;
        }

        const chosenName = resolution.newFileName?.trim();
        if (!chosenName) {
          throw new Error('Invalid empty filename provided.');
        }

        const normalizedChosen = appendOriginalExtensionIfMissing(chosenName, initialFileName);
        const chosenConflict = findCollisionCaseInsensitive(existingNames, normalizedChosen);
        if (chosenConflict) {
          // If the user typed another already-existing name, loop to confirm Replace or pick another name
          targetFileName = chosenConflict;
          replaceExisting = false;
          continue;
        }

        targetFileName = normalizedChosen;
        replaceExisting = false;
        break;
      }

      const writeRes = await plugin.writeToDestination({
        fileName: targetFileName,
        mimeType,
        base64Data,
        replaceExisting,
      });

      if (writeRes.status === 'saved') {
        if (writeRes.warning) {
          console.warn('Android SAF save warning:', writeRes.warning);
        }
        return {
          saved: true,
          fileName: writeRes.fileName || targetFileName,
          displayPath: writeRes.displayPath || displayPath,
        };
      }

      if (writeRes.status === 'needs_folder_selection') {
        replaceExisting = false;
        continue;
      }

      if (writeRes.status === 'conflict') {
        targetFileName = writeRes.existingFileName;
        replaceExisting = false;
        continue;
      }

      if (writeRes.status === 'replace_unsupported') {
        targetFileName = writeRes.existingFileName;
        replaceExisting = false;
        forcedReplaceUnsupportedReason = writeRes.reason;
        continue;
      }
    }

    throw new Error('Save did not complete after multiple conflict resolution attempts.');
  } finally {
    isSaveInProgress = false;
  }
}
