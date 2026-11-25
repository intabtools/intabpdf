// DOM text-layer lookup and active-page selection helpers (strictly scoped to target page).

export function findPageTextLayer(
  pageNumber: number,
  root?: ParentNode | null,
): HTMLElement | null {
  if (typeof document === 'undefined' || !Number.isInteger(pageNumber) || pageNumber < 1) {
    return null;
  }
  const scope: ParentNode = root ?? document;
  return scope.querySelector<HTMLElement>(`.pg-item[data-page="${pageNumber}"] .textLayer`);
}

export function selectAllTextOnPage(
  pageNumber: number,
  root?: ParentNode | null,
): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const activeTextLayer = findPageTextLayer(pageNumber, root);
  if (!activeTextLayer) {
    return false;
  }

  const hasSelectableText =
    activeTextLayer.querySelector('span:not(.markedContent)') !== null ||
    (activeTextLayer.textContent?.trim().length ?? 0) > 0;
  if (!hasSelectableText) {
    return false;
  }

  const range = document.createRange();
  range.selectNodeContents(activeTextLayer);
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
