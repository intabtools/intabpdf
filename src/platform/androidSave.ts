// Safe file saving and overwrite protection for Android.
import { Directory, Filesystem } from '@capacitor/filesystem';
import { getConflictPromptHandler } from './conflictDialog';
import { uint8ArrayToBase64 } from './index';

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
  checkExists: (name: string) => Promise<boolean>,
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

export async function checkFileExists(
  fileName: string,
  directory: Directory = Directory.Documents,
): Promise<boolean> {
  try {
    await Filesystem.stat({
      path: fileName,
      directory,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely replaces an existing file in Directory.Documents by writing to a temporary file first,
 * backing up the original, and only deleting the backup once the new file is firmly in place.
 */
export async function safeReplaceFile(
  fileName: string,
  base64Data: string,
): Promise<void> {
  const timestamp = Date.now();
  const tempPath = `.tmp_${timestamp}_${fileName}`;
  const backupPath = `.bak_${timestamp}_${fileName}`;

  // 1. Write new content to temporary file
  await Filesystem.writeFile({
    path: tempPath,
    data: base64Data,
    directory: Directory.Documents,
    recursive: true,
  });

  try {
    // 2. Rename original to backup
    await Filesystem.rename({
      from: fileName,
      to: backupPath,
      directory: Directory.Documents,
    });
  } catch (renameOriginalErr) {
    // Failed to backup original; clean up temp and abort without touching original
    try {
      await Filesystem.deleteFile({ path: tempPath, directory: Directory.Documents });
    } catch {
      // ignore
    }
    throw renameOriginalErr;
  }

  try {
    // 3. Rename temp file to target filename
    await Filesystem.rename({
      from: tempPath,
      to: fileName,
      directory: Directory.Documents,
    });
  } catch (renameTempErr) {
    // Renaming temp to target failed; restore backup to original filename
    try {
      await Filesystem.rename({
        from: backupPath,
        to: fileName,
        directory: Directory.Documents,
      });
    } catch {
      // ignore
    }
    try {
      await Filesystem.deleteFile({ path: tempPath, directory: Directory.Documents });
    } catch {
      // ignore
    }
    throw renameTempErr;
  }

  // 4. Success: remove backup
  try {
    await Filesystem.deleteFile({
      path: backupPath,
      directory: Directory.Documents,
    });
  } catch {
    // ignore
  }
}

export interface AndroidSaveResult {
  saved: boolean;
  fileName?: string;
}

export async function saveFileAndroid(
  bytes: Uint8Array,
  initialFileName: string,
): Promise<AndroidSaveResult> {
  if (isSaveInProgress) {
    throw new Error('A save operation is already in progress.');
  }

  isSaveInProgress = true;
  try {
    const base64Data = uint8ArrayToBase64(bytes);
    let targetFileName = initialFileName;

    // 1. Check if the file already exists in Documents
    const exists = await checkFileExists(targetFileName, Directory.Documents);

    if (exists) {
      const promptHandler = getConflictPromptHandler();
      if (!promptHandler) {
        throw new Error('Filename conflict detected but no resolution dialog handler is available.');
      }

      const suggestedName = await suggestUniqueFileName(targetFileName, (n) =>
        checkFileExists(n, Directory.Documents)
      );

      const resolution = await promptHandler(targetFileName, suggestedName);

      if (resolution.action === 'cancel') {
        return { saved: false };
      }

      if (resolution.action === 'replace') {
        await safeReplaceFile(targetFileName, base64Data);
      } else if (resolution.action === 'rename') {
        const chosenName = resolution.newFileName?.trim();
        if (!chosenName) {
          throw new Error('Invalid empty filename provided.');
        }

        const { ext: originalExt } = splitFileName(initialFileName);
        const { ext: chosenExt } = splitFileName(chosenName);
        let finalChosenName = chosenName;
        if (originalExt && chosenExt.toLowerCase() !== originalExt.toLowerCase()) {
          finalChosenName = `${chosenName}${originalExt}`;
        }

        // Recheck if the chosen name exists right before write to prevent race conditions
        const chosenExists = await checkFileExists(finalChosenName, Directory.Documents);
        if (chosenExists) {
          await safeReplaceFile(finalChosenName, base64Data);
        } else {
          await Filesystem.writeFile({
            path: finalChosenName,
            data: base64Data,
            directory: Directory.Documents,
            recursive: true,
          });
        }
        targetFileName = finalChosenName;
      }
    } else {
      // File does not exist yet: write directly to Documents
      await Filesystem.writeFile({
        path: targetFileName,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
      });
    }

    // 2. Mirror to Cache so native share sheet has immediate access
    let writeResultUri = '';
    try {
      const cacheWrite = await Filesystem.writeFile({
        path: targetFileName,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      writeResultUri = cacheWrite.uri;
    } catch (cacheErr) {
      console.warn('Could not mirror saved file to Cache directory:', cacheErr);
    }

    // 3. Present native Android Share sheet if supported
    try {
      const { Share } = await import('@capacitor/share');
      const canShare = await Share.canShare().then((r) => r.value).catch(() => false);
      if (canShare && writeResultUri) {
        await Share.share({
          title: targetFileName,
          url: writeResultUri,
          dialogTitle: `Save or Share ${targetFileName}`,
        });
      }
    } catch (shareErr) {
      console.warn('Share sheet display encountered an error:', shareErr);
    }

    return { saved: true, fileName: targetFileName };
  } finally {
    isSaveInProgress = false;
  }
}
