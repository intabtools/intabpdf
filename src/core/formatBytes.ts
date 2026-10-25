// Pure utility function for human-readable byte size formatting.

/**
 * Formats a byte number into a readable KB or MB string.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  return Math.round(bytes / 1024) + ' KB';
}
