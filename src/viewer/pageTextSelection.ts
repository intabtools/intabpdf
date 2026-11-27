// DOM text-layer lookup and active-page selection helpers (strictly scoped to target page).

function getNodeElement(node: Node | null): Element | null {
  if (!node) return null;
  if ('nodeType' in node && node.nodeType === 1) {
    return node as Element;
  }
  return (node as { parentElement?: Element | null }).parentElement ?? null;
}

function findSelectablePdfTextLayerForNode(
  node: Node | null,
  root?: ParentNode | null,
): HTMLElement | null {
  const el = getNodeElement(node);
  if (!el || typeof el.closest !== 'function') return null;
  if (el.closest('.markedContent, [role="img"], .endOfContent, .copy-restricted')) {
    return null;
  }
  const layer = el.closest<HTMLElement>('.vwr .textLayer');
  if (!layer) return null;
  if (root && typeof (root as Node).contains === 'function' && !(root as Node).contains(layer)) {
    return null;
  }
  return layer;
}

export function isSelectionInsidePdfTextLayer(root?: ParentNode | null): boolean {
  if (typeof window === 'undefined') return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return (
    findSelectablePdfTextLayerForNode(range.startContainer, root) !== null ||
    findSelectablePdfTextLayerForNode(range.endContainer, root) !== null ||
    findIntersectingPdfTextLayers(range, root).length > 0
  );
}

export function resolveSelectionPageNumber(root?: ParentNode | null): number | null {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const candidates: Array<Node | null> = [
    selection.anchorNode,
    selection.focusNode,
    selection.getRangeAt(0).startContainer,
  ];
  for (const node of candidates) {
    const layer = findSelectablePdfTextLayerForNode(node, root);
    const pageEl = layer?.closest<HTMLElement>('.pg-item[data-page]');
    const parsed = pageEl ? Number.parseInt(pageEl.dataset.page ?? '', 10) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function findIntersectingPdfTextLayers(
  range: Range,
  root?: ParentNode | null,
): HTMLElement[] {
  const scope: ParentNode | null = root ?? (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') {
    return [];
  }
  const allLayers = scope.querySelectorAll<HTMLElement>('.vwr .textLayer:not(.copy-restricted)');
  const intersecting: HTMLElement[] = [];
  for (const layer of allLayers) {
    try {
      if (
        (typeof range.intersectsNode === 'function' && range.intersectsNode(layer)) ||
        layer.contains(range.startContainer) ||
        layer.contains(range.endContainer)
      ) {
        intersecting.push(layer);
      }
    } catch {
      // Ignore detached layer checks
    }
  }
  return intersecting;
}

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

function collectSelectableTextNodes(textLayer: HTMLElement): Text[] {
  if (typeof textLayer.querySelectorAll !== 'function' || typeof document.createTreeWalker !== 'function') {
    return [];
  }
  const spans = textLayer.querySelectorAll<HTMLElement>('span:not(.markedContent):not([role="img"])');
  const nodes: Text[] = [];
  for (const span of spans) {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode() as Text | null;
    while (current) {
      if ((current.textContent?.length ?? 0) > 0) {
        nodes.push(current);
      }
      current = walker.nextNode() as Text | null;
    }
  }
  return nodes;
}

function applySelectionInPlace(
  selection: Selection,
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): void {
  if (selection.rangeCount > 0 && typeof selection.setBaseAndExtent === 'function') {
    selection.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
    return;
  }
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Clamps any browser/WebView selection that started or intersects inside `.vwr .textLayer`
 * so neither endpoint can escape into app header branding ("InTabPDF"), toolbars, or placeholders.
 * Returns true if the selection was modified.
 */
export function clampSelectionToPdfTextLayers(root?: ParentNode | null): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const activeEl = document.activeElement;
  if (
    activeEl &&
    (activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      (activeEl as HTMLElement).isContentEditable)
  ) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const startInPdf = findSelectablePdfTextLayerForNode(range.startContainer, root) !== null;
  const endInPdf = findSelectablePdfTextLayerForNode(range.endContainer, root) !== null;
  if (startInPdf && endInPdf) {
    return false;
  }

  const intersectingLayers = findIntersectingPdfTextLayers(range, root);
  if (intersectingLayers.length === 0) {
    return false;
  }

  const textNodes: Text[] = [];
  for (const layer of intersectingLayers) {
    textNodes.push(...collectSelectableTextNodes(layer));
  }
  if (textNodes.length === 0) {
    selection.removeAllRanges();
    return true;
  }

  const firstText = textNodes[0];
  const lastText = textNodes[textNodes.length - 1];
  const nextStartNode = startInPdf ? range.startContainer : firstText;
  const nextStartOffset = startInPdf ? range.startOffset : 0;
  const nextEndNode = endInPdf ? range.endContainer : lastText;
  const nextEndOffset = endInPdf ? range.endOffset : (lastText.textContent?.length ?? 0);

  applySelectionInPlace(selection, nextStartNode, nextStartOffset, nextEndNode, nextEndOffset);
  return true;
}

/**
 * Selects all text strictly inside the target page's `.textLayer` using Blink's editing-host
 * `selectAll` command while preserving Android WebView's native selection handles and ActionMode.
 * Falls back to programmatic Range selection if `execCommand('selectAll')` cannot populate a range.
 */
export function selectAllTextNativeInPdfPage(
  pageNumber: number,
  root?: ParentNode | null,
): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !Number.isInteger(pageNumber) || pageNumber < 1) {
    return false;
  }
  const activeTextLayer = findPageTextLayer(pageNumber, root);
  if (!activeTextLayer || activeTextLayer.classList.contains('copy-restricted')) {
    return false;
  }

  const hasSelectableText =
    activeTextLayer.querySelector('span:not(.markedContent):not([role="img"])') !== null ||
    (activeTextLayer.textContent?.trim().length ?? 0) > 0;
  if (!hasSelectableText) {
    return false;
  }

  const scrollContainer = activeTextLayer.closest<HTMLElement>('.vwr');
  const prevScrollTop = scrollContainer?.scrollTop ?? 0;
  const prevScrollLeft = scrollContainer?.scrollLeft ?? 0;

  const hiddenOverlays: Array<{ el: HTMLElement; prevDisplay: string }> = [];
  const nonTextOverlays = activeTextLayer.querySelectorAll<HTMLElement>(
    '.endOfContent, .markedContent, span[role="img"]',
  );
  for (const el of nonTextOverlays) {
    hiddenOverlays.push({ el, prevDisplay: el.style.display });
    el.style.display = 'none';
  }

  const prevContentEditable = activeTextLayer.getAttribute('contenteditable');
  const prevInputMode = activeTextLayer.getAttribute('inputmode');
  const prevOutline = activeTextLayer.style.outline;

  let scopedExecSucceeded = false;
  try {
    activeTextLayer.style.outline = 'none';
    activeTextLayer.setAttribute('inputmode', 'none');
    activeTextLayer.setAttribute('contenteditable', 'true');
    activeTextLayer.focus({ preventScroll: true });

    if (typeof document.execCommand === 'function') {
      document.execCommand('selectAll');
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        const startInActive = activeTextLayer.contains(r.startContainer);
        const endInActive = activeTextLayer.contains(r.endContainer);
        if (startInActive && endInActive && (sel.toString().trim().length > 0)) {
          scopedExecSucceeded = true;
        }
      }
    }
  } finally {
    if (typeof activeTextLayer.blur === 'function') {
      activeTextLayer.blur();
    }
    if (prevContentEditable === null) {
      activeTextLayer.removeAttribute('contenteditable');
    } else {
      activeTextLayer.setAttribute('contenteditable', prevContentEditable);
    }
    if (prevInputMode === null) {
      activeTextLayer.removeAttribute('inputmode');
    } else {
      activeTextLayer.setAttribute('inputmode', prevInputMode);
    }
    activeTextLayer.style.outline = prevOutline;
    for (const { el, prevDisplay } of hiddenOverlays) {
      el.style.display = prevDisplay;
    }
    if (scrollContainer) {
      scrollContainer.scrollTop = prevScrollTop;
      scrollContainer.scrollLeft = prevScrollLeft;
    }
  }

  if (scopedExecSucceeded) {
    return true;
  }

  return selectAllTextOnPage(pageNumber, root);
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
    activeTextLayer.querySelector('span:not(.markedContent):not([role="img"])') !== null ||
    (activeTextLayer.textContent?.trim().length ?? 0) > 0;
  if (!hasSelectableText) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  const textNodes = collectSelectableTextNodes(activeTextLayer);
  if (textNodes.length > 0) {
    const firstText = textNodes[0];
    const lastText = textNodes[textNodes.length - 1];
    const endOffset = lastText.textContent?.length ?? 0;
    // Update active selection in place when possible so Chromium WebView keeps its native ActionMode bar open.
    applySelectionInPlace(selection, firstText, 0, lastText, endOffset);
    return true;
  }

  const range = document.createRange();
  range.selectNodeContents(activeTextLayer);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
