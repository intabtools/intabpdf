// Pure viewport-safe positioning logic for the PDF viewer contextual selection menu.

export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export type SelectionOrigin = 'range' | 'select-all';

export interface ComputeSelectionMenuPositionInput {
  origin: SelectionOrigin;
  clientRects: RectLike[];
  boundingRect: RectLike;
  containerViewportRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
  };
  viewportWidth: number;
  viewportHeight: number;
  menuWidth: number;
  menuHeight: number;
  isFullscreen?: boolean;
}

export function clampSelectionMenuLeft(
  anchorCenterX: number,
  measuredWidth: number,
  viewportWidth: number,
): number {
  const safeWidth = Math.max(120, measuredWidth);
  const maxLeft = Math.max(12, viewportWidth - safeWidth - 12);
  return Math.max(12, Math.min(maxLeft, anchorCenterX - safeWidth / 2));
}

export function clampSelectionMenuTop(
  preferredTop: number,
  menuHeight: number,
  minTop: number,
  viewportHeight: number,
  bottomMargin = 16,
): number {
  const maxTop = Math.max(minTop, viewportHeight - menuHeight - bottomMargin);
  return Math.max(minTop, Math.min(maxTop, preferredTop));
}

/**
 * Computes fixed viewport coordinates for the floating selection menu.
 * For Select All, anchors stably inside the current visible canvas viewport without using full-page rects.
 * For normal range selections, picks the union of rects currently visible in the viewport and clamps bounds.
 */
export function computeSelectionMenuPosition(
  input: ComputeSelectionMenuPositionInput,
): { top: number; left: number; anchorCenterX: number } {
  const {
    origin,
    clientRects,
    boundingRect,
    containerViewportRect,
    viewportWidth,
    viewportHeight,
    menuWidth,
    menuHeight,
    isFullscreen = false,
  } = input;

  const minTop = Math.max(
    12,
    containerViewportRect.top + 8,
    isFullscreen ? 58 : 0,
  );
  const bottomLimit = Math.min(viewportHeight - 12, containerViewportRect.bottom - 8);

  if (origin === 'select-all') {
    const centerX =
      containerViewportRect.width > 0
        ? containerViewportRect.left + containerViewportRect.width / 2
        : viewportWidth / 2;
    const stableTop = clampSelectionMenuTop(
      minTop + 4,
      menuHeight,
      minTop,
      viewportHeight,
    );
    return {
      top: stableTop,
      left: clampSelectionMenuLeft(centerX, menuWidth, viewportWidth),
      anchorCenterX: centerX,
    };
  }

  // Filter non-empty client rects overlapping the active visible vertical region
  const nonZeroRects = clientRects.filter((r) => r.width > 0 || r.height > 0);
  const visibleRects = nonZeroRects.filter(
    (r) => r.bottom >= minTop - 20 && r.top <= bottomLimit + 20,
  );

  const sourceRects = visibleRects.length > 0 ? visibleRects : nonZeroRects.length > 0 ? nonZeroRects : [boundingRect];

  let top = sourceRects[0].top;
  let bottom = sourceRects[0].bottom;
  let left = sourceRects[0].left;
  let right = sourceRects[0].right;

  for (let i = 1; i < sourceRects.length; i += 1) {
    const r = sourceRects[i];
    if (r.top < top) top = r.top;
    if (r.bottom > bottom) bottom = r.bottom;
    if (r.left < left) left = r.left;
    if (r.right > right) right = r.right;
  }

  const aboveTop = top - menuHeight - 8;
  const preferredTop = aboveTop >= minTop ? aboveTop : bottom + 8;
  const clampedTop = clampSelectionMenuTop(preferredTop, menuHeight, minTop, viewportHeight);
  const anchorCenterX = (left + right) / 2;

  return {
    top: clampedTop,
    left: clampSelectionMenuLeft(anchorCenterX, menuWidth, viewportWidth),
    anchorCenterX,
  };
}
