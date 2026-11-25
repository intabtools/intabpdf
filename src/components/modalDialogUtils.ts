// Internal modal stack management, background inertness, scroll lock, and focus utilities.

export interface ModalStackEntry {
  id: string;
  backdropEl: HTMLElement | null;
  dialogEl: HTMLElement | null;
}

interface BackgroundElementState {
  prevInert: boolean;
  prevAriaHidden: string | null;
}

const modalStack: ModalStackEntry[] = [];
const backgroundStateMap = new Map<HTMLElement, BackgroundElementState>();
let savedBodyOverflow: string | null = null;

const NON_INTERACTIVE_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Synchronizes body scroll lock, background inertness/aria-hidden, and per-modal topmost state.
 */
function syncModalEnvironment(): void {
  if (typeof document === 'undefined') return;

  const top = modalStack.length > 0 ? modalStack[modalStack.length - 1] : null;
  const activeBackdrops = new Set<HTMLElement>();

  for (const entry of modalStack) {
    if (entry.backdropEl) {
      activeBackdrops.add(entry.backdropEl);
      if (entry === top) {
        entry.backdropEl.inert = false;
        entry.backdropEl.removeAttribute('aria-hidden');
      } else {
        entry.backdropEl.inert = true;
        entry.backdropEl.setAttribute('aria-hidden', 'true');
      }
    }
  }

  if (top) {
    if (savedBodyOverflow === null) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    if (document.body && 'children' in document.body && document.body.children) {
      const bodyChildren = Array.from(document.body.children);
      for (const child of bodyChildren) {
        if (
          child instanceof HTMLElement &&
          !activeBackdrops.has(child) &&
          !NON_INTERACTIVE_TAGS.has(child.tagName)
        ) {
          if (!backgroundStateMap.has(child)) {
            backgroundStateMap.set(child, {
              prevInert: Boolean(child.inert),
              prevAriaHidden: child.getAttribute('aria-hidden'),
            });
          }
          child.inert = true;
          child.setAttribute('aria-hidden', 'true');
        }
      }
    }
  } else {
    if (savedBodyOverflow !== null) {
      document.body.style.overflow = savedBodyOverflow;
      savedBodyOverflow = null;
    }

    for (const [el, prev] of backgroundStateMap.entries()) {
      if (el.isConnected !== false) {
        el.inert = prev.prevInert;
        if (prev.prevAriaHidden === null) {
          el.removeAttribute('aria-hidden');
        } else {
          el.setAttribute('aria-hidden', prev.prevAriaHidden);
        }
      }
    }
    backgroundStateMap.clear();
  }
}

/**
 * Registers an open modal entry on the stack and updates background inertness & scroll lock.
 */
export function pushModal(entry: ModalStackEntry | string): void {
  const normalized: ModalStackEntry =
    typeof entry === 'string'
      ? { id: entry, backdropEl: null, dialogEl: null }
      : entry;

  const existingIdx = modalStack.findIndex((item) => item.id === normalized.id);
  if (existingIdx !== -1) {
    modalStack.splice(existingIdx, 1);
  }
  modalStack.push(normalized);
  syncModalEnvironment();
}

/**
 * Removes a modal entry by ID and returns whether it was topmost along with the new top modal.
 */
export function popModal(id: string): { wasTop: boolean; nextTop: ModalStackEntry | null } {
  const wasTop = modalStack.length > 0 && modalStack[modalStack.length - 1].id === id;
  const index = modalStack.findIndex((item) => item.id === id);
  if (index !== -1) {
    modalStack.splice(index, 1);
  }
  syncModalEnvironment();
  const nextTop = modalStack.length > 0 ? modalStack[modalStack.length - 1] : null;
  return { wasTop, nextTop };
}

/**
 * Returns true if the specified modal ID is the topmost active modal.
 */
export function isTopModal(id: string): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1].id === id;
}

/**
 * Returns the number of currently registered open modals.
 */
export function getActiveModalCount(): number {
  return modalStack.length;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

function isElementVisible(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
  if (style && (style.visibility === 'hidden' || style.display === 'none')) {
    return false;
  }
  return true;
}

/**
 * Returns keyboard-focusable (tabIndex >= 0, enabled, visible) elements inside a container.
 */
export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && isElementVisible(el)
  );
}
