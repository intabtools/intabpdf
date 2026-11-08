// Validation logic for drop zone file selection limits.

/**
 * Validates file selection count against the multiple flag.
 * Returns true if the selection is accepted, or false if rejected.
 */
export function validateFileSelectionCount(
  count: number,
  multiple: boolean,
  onMultipleRejected?: (count: number) => void
): boolean {
  if (!multiple && count > 1) {
    onMultipleRejected?.(count);
    return false;
  }
  return true;
}
