import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import ModalDialog from './ModalDialog';
import {
  getActiveModalCount,
  isTopModal,
  popModal,
  pushModal,
} from './modalDialogUtils';
import { FileConflictProvider } from './FileConflictDialog';
import { getConflictPromptHandler } from '../platform/conflictDialog';

function createMockElement(tagName = 'DIV') {
  const attrs = new Map<string, string>();
  return {
    tagName,
    inert: false,
    isConnected: true,
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
    setAttribute(name: string, val: string) {
      attrs.set(name, val);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
  };
}

describe('ModalDialog Component Unit & Accessibility Tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    popModal('modal-a');
    popModal('modal-b');
    popModal('modal-single');
    popModal('modal-strict');
  });

  it('renders nothing when isOpen is false', () => {
    const html = renderToString(
      <ModalDialog isOpen={false} onClose={() => {}} title="Hidden Dialog">
        <p>Body text</p>
      </ModalDialog>
    );

    expect(html).toBe('');
  });

  it('renders role="dialog", aria-modal="true", aria-labelledby, and optional aria-describedby when open', () => {
    const htmlWithDesc = renderToString(
      <ModalDialog
        isOpen={true}
        onClose={() => {}}
        title="Confirm Deletion"
        description="This action cannot be undone."
      >
        <button type="button">Confirm</button>
      </ModalDialog>
    );

    expect(htmlWithDesc).toContain('class="mo modal-backdrop"');
    expect(htmlWithDesc).toContain('role="presentation"');
    expect(htmlWithDesc).toContain('class="dlg modal-dialog"');
    expect(htmlWithDesc).toContain('role="dialog"');
    expect(htmlWithDesc).toContain('aria-modal="true"');
    expect(htmlWithDesc).toMatch(/aria-labelledby="modal-[^"]+-title"/);
    expect(htmlWithDesc).toMatch(/aria-describedby="modal-[^"]+-desc"/);
    expect(htmlWithDesc).toContain('Confirm Deletion');
    expect(htmlWithDesc).toContain('This action cannot be undone.');

    const htmlNoDesc = renderToString(
      <ModalDialog isOpen={true} onClose={() => {}} title="Simple Notice">
        <p>Only content</p>
      </ModalDialog>
    );

    expect(htmlNoDesc).toMatch(/aria-labelledby="modal-[^"]+-title"/);
    expect(htmlNoDesc).not.toContain('aria-describedby=');
  });

  it('supports optional closeDisabled state, custom closeLabel, and hiding close button', () => {
    const htmlDisabled = renderToString(
      <ModalDialog
        isOpen={true}
        onClose={() => {}}
        title="Processing"
        closeDisabled={true}
        closeLabel="Dismiss"
      >
        <p>Working...</p>
      </ModalDialog>
    );

    expect(htmlDisabled).toContain('aria-label="Dismiss"');
    expect(htmlDisabled).toContain('disabled=""');

    const htmlNoClose = renderToString(
      <ModalDialog
        isOpen={true}
        onClose={() => {}}
        title="Forced Action"
        showCloseButton={false}
      >
        <button type="button">OK</button>
      </ModalDialog>
    );

    expect(htmlNoClose).not.toContain('modal-close-btn');
  });

  it('renders custom titleId, icon, maxWidth, and long overflowing text safely', () => {
    const longTitle = 'A'.repeat(120) + '_VeryLongDocumentFilename.pdf';
    const longDesc = 'Detailed explanation '.repeat(25);

    const html = renderToString(
      <ModalDialog
        isOpen={true}
        onClose={() => {}}
        title={longTitle}
        titleId="custom-title-id"
        description={longDesc}
        maxWidth="460px"
        icon={<span data-testid="modal-icon">!</span>}
      >
        <div>Body</div>
      </ModalDialog>
    );

    expect(html).toContain('id="custom-title-id"');
    expect(html).toContain('aria-labelledby="custom-title-id"');
    expect(html).toContain('--modal-max-width:460px');
    expect(html).toContain('data-testid="modal-icon"');
    expect(html).toContain(longTitle);
  });

  it('renders FileConflictProvider children without dialog when no conflict is active', () => {
    const html = renderToString(
      <FileConflictProvider>
        <div id="app-child">App Content</div>
      </FileConflictProvider>
    );

    expect(html).toContain('App Content');
    expect(html).not.toContain('role="dialog"');
    expect(typeof getConflictPromptHandler).toBe('function');
  });

  describe('Modal Stack, Background Inertness, StrictMode, and Scroll-Lock Reference Counting', () => {
    it('locks body overflow on first modal open and restores original value when last modal closes', () => {
      const mockBodyStyle = { overflow: 'auto' };
      vi.stubGlobal('document', { body: { style: mockBodyStyle } });

      expect(getActiveModalCount()).toBe(0);

      pushModal('modal-single');
      expect(getActiveModalCount()).toBe(1);
      expect(mockBodyStyle.overflow).toBe('hidden');
      expect(isTopModal('modal-single')).toBe(true);

      const res = popModal('modal-single');
      expect(res.wasTop).toBe(true);
      expect(res.nextTop).toBeNull();
      expect(getActiveModalCount()).toBe(0);
      expect(mockBodyStyle.overflow).toBe('auto');
      expect(isTopModal('modal-single')).toBe(false);
    });

    it('synchronizes inertness on background and lower modals while keeping topmost modal active', () => {
      const mockBodyStyle = { overflow: '' };
      const rootEl = createMockElement('DIV');
      const backdropA = createMockElement('DIV');
      const backdropB = createMockElement('DIV');
      const children = [rootEl, backdropA, backdropB];

      vi.stubGlobal('HTMLElement', Object);
      vi.stubGlobal('document', {
        body: { style: mockBodyStyle, children },
      });

      // Open Modal A: background rootEl becomes inert, backdropA stays active
      pushModal({
        id: 'modal-a',
        backdropEl: backdropA as unknown as HTMLElement,
        dialogEl: null,
      });
      expect(rootEl.inert).toBe(true);
      expect(rootEl.getAttribute('aria-hidden')).toBe('true');
      expect(backdropA.inert).toBe(false);
      expect(backdropA.getAttribute('aria-hidden')).toBeNull();

      // Open Nested Modal B: backdropA becomes inert, backdropB stays active
      pushModal({
        id: 'modal-b',
        backdropEl: backdropB as unknown as HTMLElement,
        dialogEl: null,
      });
      expect(rootEl.inert).toBe(true);
      expect(backdropA.inert).toBe(true);
      expect(backdropA.getAttribute('aria-hidden')).toBe('true');
      expect(backdropB.inert).toBe(false);
      expect(backdropB.getAttribute('aria-hidden')).toBeNull();

      // Close Topmost Modal B: backdropA restores active, rootEl remains inert
      const popB = popModal('modal-b');
      expect(popB.wasTop).toBe(true);
      expect(popB.nextTop?.id).toBe('modal-a');
      expect(backdropA.inert).toBe(false);
      expect(backdropA.getAttribute('aria-hidden')).toBeNull();
      expect(rootEl.inert).toBe(true);
      expect(mockBodyStyle.overflow).toBe('hidden');

      // Close Modal A: rootEl inertness and body overflow restore cleanly
      const popA = popModal('modal-a');
      expect(popA.wasTop).toBe(true);
      expect(popA.nextTop).toBeNull();
      expect(rootEl.inert).toBe(false);
      expect(rootEl.getAttribute('aria-hidden')).toBeNull();
      expect(mockBodyStyle.overflow).toBe('');
    });

    it('handles unexpected non-topmost unmount without disrupting topmost modal or scroll lock', () => {
      const mockBodyStyle = { overflow: '' };
      const backdropA = createMockElement('DIV');
      const backdropB = createMockElement('DIV');

      vi.stubGlobal('HTMLElement', Object);
      vi.stubGlobal('document', {
        body: { style: mockBodyStyle, children: [backdropA, backdropB] },
      });

      pushModal({
        id: 'modal-a',
        backdropEl: backdropA as unknown as HTMLElement,
        dialogEl: null,
      });
      pushModal({
        id: 'modal-b',
        backdropEl: backdropB as unknown as HTMLElement,
        dialogEl: null,
      });

      // Lower modal A unmounts unexpectedly while B is active
      const popA = popModal('modal-a');
      expect(popA.wasTop).toBe(false);
      expect(popA.nextTop?.id).toBe('modal-b');
      expect(isTopModal('modal-b')).toBe(true);
      expect(backdropB.inert).toBe(false);
      expect(mockBodyStyle.overflow).toBe('hidden');

      // Closing B finally releases lock
      popModal('modal-b');
      expect(getActiveModalCount()).toBe(0);
      expect(mockBodyStyle.overflow).toBe('');
    });

    it('preserves consistent stack and scroll lock across StrictMode mount -> cleanup -> remount', () => {
      const mockBodyStyle = { overflow: 'scroll' };
      vi.stubGlobal('document', { body: { style: mockBodyStyle } });

      pushModal('modal-strict');
      expect(getActiveModalCount()).toBe(1);
      expect(mockBodyStyle.overflow).toBe('hidden');

      // StrictMode simulated cleanup
      popModal('modal-strict');
      expect(getActiveModalCount()).toBe(0);
      expect(mockBodyStyle.overflow).toBe('scroll');

      // StrictMode simulated remount
      pushModal('modal-strict');
      expect(getActiveModalCount()).toBe(1);
      expect(mockBodyStyle.overflow).toBe('hidden');

      popModal('modal-strict');
      expect(getActiveModalCount()).toBe(0);
      expect(mockBodyStyle.overflow).toBe('scroll');
    });
  });
});
