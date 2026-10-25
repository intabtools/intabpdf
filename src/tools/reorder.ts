/**
 * Pure utility functions for array reordering and drag-and-drop position calculations.
 */

/**
 * Moves an item from fromIndex to toIndex in a list immutably.
 */
export function reorderItems<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length
  ) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Calculates the destination index when dropping before or after a target element.
 */
export function calculateDropIndex(
  fromIndex: number,
  targetIndex: number,
  position: 'before' | 'after'
): number {
  if (fromIndex === targetIndex) {
    return fromIndex;
  }

  if (fromIndex < targetIndex) {
    return position === 'before' ? targetIndex - 1 : targetIndex;
  } else {
    return position === 'before' ? targetIndex : targetIndex + 1;
  }
}
