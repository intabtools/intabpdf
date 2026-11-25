import type { ReactNode } from 'react';

export interface SegmentedControlOption<T extends string | number = string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
}

/**
 * Calculates the next enabled option index when stepping linearly (+1 / -1)
 * or vertically in a 2D grid (ArrowDown / ArrowUp when columns > 1).
 * Wraps around edges and skips disabled options without premature cycling.
 */
export function getNextSegmentIndex<T extends string | number>(
  currentIndex: number,
  direction: 'next' | 'prev' | 'down' | 'up',
  options: SegmentedControlOption<T>[],
  optionsConfig: { disabled?: boolean; columns?: number } = {}
): number {
  const { disabled = false, columns = 1 } = optionsConfig;
  const count = options.length;
  if (count === 0 || disabled) return currentIndex;

  // 1D linear stepping (or horizontal ArrowRight/ArrowLeft in 2D grid)
  if (direction === 'next' || direction === 'prev' || columns <= 1) {
    const step = direction === 'prev' || direction === 'up' ? -1 : 1;
    let next = currentIndex;
    for (let i = 0; i < count; i++) {
      next = (next + step + count) % count;
      if (!options[next].disabled) {
        return next;
      }
    }
    return currentIndex;
  }

  // 2D vertical stepping (ArrowDown / ArrowUp when columns > 1)
  const totalRows = Math.ceil(count / columns);
  const currentRow = Math.floor(currentIndex / columns);
  const currentCol = currentIndex % columns;
  const rowStep = direction === 'down' ? 1 : -1;

  // 1. Prefer an enabled cell in the same column on another row
  for (let r = 1; r < totalRows; r++) {
    const targetRow = (currentRow + r * rowStep + totalRows) % totalRows;
    const candidate = targetRow * columns + currentCol;
    if (candidate < count && !options[candidate].disabled) {
      return candidate;
    }
  }

  // 2. Fallback: find an enabled cell in another row (closest in vertical direction)
  for (let r = 1; r < totalRows; r++) {
    const targetRow = (currentRow + r * rowStep + totalRows) % totalRows;
    const rowStart = targetRow * columns;
    const rowEnd = Math.min(rowStart + columns, count);
    if (direction === 'down') {
      for (let idx = rowStart; idx < rowEnd; idx++) {
        if (!options[idx].disabled) return idx;
      }
    } else {
      for (let idx = rowEnd - 1; idx >= rowStart; idx--) {
        if (!options[idx].disabled) return idx;
      }
    }
  }

  return currentIndex;
}
