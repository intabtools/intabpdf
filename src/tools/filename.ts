// Pure helper functions for generating, sanitizing, and validating tool output filenames.

/**
 * Extracts a clean base name from a file name by removing known extensions.
 */
export function getCleanBaseName(fileName: string): string {
  if (!fileName) return '';
  return fileName.replace(/\.(pdf|jpe?g|png|webp|gif|bmp|txt|zip)$/i, '').trim();
}

/**
 * Generates a sensible default output base name based on the tool operation and staged files.
 */
export function getDefaultOutputBaseName(
  toolId: string,
  stagedFiles: { name: string }[] = []
): string {
  const firstFile = stagedFiles[0]?.name ? getCleanBaseName(stagedFiles[0].name) : '';

  switch (toolId) {
    case 'rotate':
      return firstFile ? `rotated-${firstFile}` : 'rotated-document';

    case 'remove-pages':
      return firstFile ? `edited-${firstFile}` : 'edited-document';

    case 'split':
      return firstFile ? `split-${firstFile}` : 'split-document';

    case 'compress':
      return firstFile ? `compressed-${firstFile}` : 'compressed-document';

    case 'merge':
      return firstFile ? `merged-${firstFile}` : 'merged-document';

    case 'images-to-pdf':
      return 'images-to-pdf';

    default:
      return firstFile ? `${toolId}-${firstFile}` : `${toolId}-document`;
  }
}

/**
 * Returns the expected output extension (e.g. '.pdf' or '.zip') for a given tool.
 */
export function getOutputExtension(toolId: string, outputName = ''): '.pdf' | '.zip' {
  if (toolId === 'split' || outputName.toLowerCase().endsWith('.zip')) {
    return '.zip';
  }
  return '.pdf';
}

/**
 * Validates and sanitizes a user-edited base name for safe cross-platform saving.
 * 
 * Rules:
 * - Trims leading and trailing whitespace.
 * - Strips duplicate extensions if the user manually typed '.pdf' or '.zip'.
 * - Replaces illegal filesystem characters across Windows, macOS, Linux, and Android with '-'.
 * - Collapses consecutive dashes and removes leading/trailing dots or dashes.
 * - Appends '-file' to Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
 * - Falls back to a clean default name if empty or invalid.
 * - Appends the fixed output extension.
 */
export function sanitizeOutputFileName(
  input: string,
  fallbackBaseName: string,
  extension: '.pdf' | '.zip' = '.pdf'
): string {
  let base = (input || '').trim();

  // Strip duplicate extension if user typed it
  base = base.replace(new RegExp(`\\${extension}$`, 'i'), '');
  base = base.replace(/\.(pdf|zip)$/i, '');

  // Replace illegal filesystem characters: / \ : * ? " < > | and control characters (0x00-0x1F)
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[/\\:*?"<>|\x00-\x1F]/g, '-');

  // Collapse multiple dashes
  base = base.replace(/-+/g, '-');

  // Trim leading/trailing dots, dashes, or whitespace
  base = base.trim().replace(/^[.-]+|[.-]+$/g, '');

  // Check Windows reserved device names: CON, PRN, AUX, NUL, COM1-9, LPT1-9
  const isWindowsReserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(base);
  if (isWindowsReserved) {
    base = `${base}-file`;
  }

  // Fallback if empty after sanitization
  if (!base) {
    base = fallbackBaseName.replace(new RegExp(`\\${extension}$`, 'i'), '').trim() || 'document';
    base = base.replace(/\.(pdf|zip)$/i, '');
  }

  return `${base}${extension}`;
}
