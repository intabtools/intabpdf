// Web-specific PDF viewing flow: opens PDFs in a new browser tab using native browser rendering.
// Manages Blob URL lifecycle safely without premature revocation or indefinite memory leakage.

interface TrackedUrl {
  url: string;
  createdAt: number;
}

const activeObjectUrls: TrackedUrl[] = [];
const URL_EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

function cleanupExpiredUrls(now: number = Date.now()): void {
  for (let i = activeObjectUrls.length - 1; i >= 0; i--) {
    const item = activeObjectUrls[i];
    if (now - item.createdAt >= URL_EXPIRATION_MS) {
      try {
        URL.revokeObjectURL(item.url);
      } catch {
        // Ignored
      }
      activeObjectUrls.splice(i, 1);
    }
  }
}

// Ensure all tracked URLs are released when the main window unloads
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    revokeAllTrackedBlobUrls();
  });
}

/**
 * Revokes all currently tracked Blob URLs. Useful for testing and on unload.
 */
export function revokeAllTrackedBlobUrls(): void {
  while (activeObjectUrls.length > 0) {
    const item = activeObjectUrls.pop();
    if (item) {
      try {
        URL.revokeObjectURL(item.url);
      } catch {
        // Ignored
      }
    }
  }
}

/**
 * Returns the number of currently tracked Blob URLs.
 */
export function getTrackedBlobUrlCount(): number {
  return activeObjectUrls.length;
}

/**
 * Opens a PDF in a new browser tab from a user interaction click handler.
 * Uses native browser PDF rendering instead of an in-app embedded viewer.
 *
 * @param bytes Raw PDF file bytes
 * @param fileName Intended output filename
 * @returns boolean indicating whether the new tab was opened successfully
 */
export function openPdfInNewTab(bytes: Uint8Array, fileName: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  // Purge any URLs older than URL_EXPIRATION_MS
  cleanupExpiredUrls();

  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const rawUrl = URL.createObjectURL(blob);

  // Append a filename hash hint so Chromium/Firefox can default to the intended name upon native save
  const safeName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const urlWithHint = `${rawUrl}#filename=${encodeURIComponent(safeName)}`;

  activeObjectUrls.push({ url: rawUrl, createdAt: Date.now() });

  try {
    const newWindow = window.open(urlWithHint, '_blank');
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to open PDF in new tab:', err);
    return false;
  }
}
