// Cross-platform clipboard helper using scoped Electron IPC when available,
// standard Async Clipboard API, and execCommand fallback for constrained WebViews.

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Electron scoped preload bridge (uses main-process Electron clipboard safely)
  if (typeof window !== 'undefined' && typeof window.intab?.copyText === 'function') {
    try {
      const ok = await window.intab.copyText(text);
      if (ok) return true;
    } catch {
      // Fall through to browser clipboard API
    }
  }

  // 2. Standard Async Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to textarea fallback when permission is denied or unavailable
    }
  }

  // 3. Fallback via off-screen readonly textarea (preserves user-initiated copy on legacy WebViews)
  if (typeof document !== 'undefined' && document.body && typeof document.execCommand === 'function') {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const savedRanges: Range[] = [];
    if (selection) {
      for (let i = 0; i < selection.rangeCount; i += 1) {
        savedRanges.push(selection.getRangeAt(i).cloneRange());
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    try {
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const copied = document.execCommand('copy');
      return copied;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
      if (selection) {
        selection.removeAllRanges();
        for (const range of savedRanges) {
          selection.addRange(range);
        }
      }
    }
  }

  return false;
}
