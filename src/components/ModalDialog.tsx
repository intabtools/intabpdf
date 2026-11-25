// Reusable accessible modal dialog with portal isolation, focus trapping, Escape/backdrop rules, and scroll lock.
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';
import {
  getFocusableElements,
  isTopModal,
  popModal,
  pushModal,
} from './modalDialogUtils';

export interface ModalDialogProps {
  /** Controlled open/closed state */
  isOpen: boolean;
  /** Callback fired when dialog requests to close */
  onClose: () => void;
  /** Dialog heading title */
  title: ReactNode;
  /** Optional icon rendered alongside the title */
  icon?: ReactNode;
  /** Optional short description connected via aria-describedby */
  description?: ReactNode;
  /** Dialog contents */
  children: ReactNode;
  /** Whether pressing Escape closes the dialog. Defaults to true. */
  dismissOnEscape?: boolean;
  /** Whether clicking the backdrop closes the dialog. Defaults to true. */
  dismissOnBackdrop?: boolean;
  /** Whether to show the top-right close (X) button. Defaults to true. */
  showCloseButton?: boolean;
  /** Whether close interactions (X button, Escape, backdrop) are disabled. Defaults to false. */
  closeDisabled?: boolean;
  /** Accessible label for the header close button. Defaults to "Close". */
  closeLabel?: string;
  /** Optional element ref to focus when the dialog opens */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Maximum dialog card width CSS value. Defaults to "440px". */
  maxWidth?: string;
  /** Optional inline style overrides for the dialog card */
  cardStyle?: CSSProperties;
  /** Optional extra class name for the dialog card */
  className?: string;
  /** Optional explicit id for the title element */
  titleId?: string;
}

export default function ModalDialog({
  isOpen,
  onClose,
  title,
  icon,
  description,
  children,
  dismissOnEscape = true,
  dismissOnBackdrop = true,
  showCloseButton = true,
  closeDisabled = false,
  closeLabel = 'Close',
  initialFocusRef,
  maxWidth = '440px',
  cardStyle,
  className = '',
  titleId,
}: ModalDialogProps): ReactNode {
  const generatedId = useId();
  const dialogId = `modal-${generatedId}`;
  const resolvedTitleId = titleId || `${dialogId}-title`;
  const descriptionId = `${dialogId}-desc`;

  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const backdropMouseDownRef = useRef(false);

  // Latest callbacks/flags stored in refs so lifecycle effects do not churn on re-renders
  const onCloseRef = useRef(onClose);
  const dismissOnEscapeRef = useRef(dismissOnEscape);
  const closeDisabledRef = useRef(closeDisabled);
  const initialFocusRefHolder = useRef(initialFocusRef);

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissOnEscapeRef.current = dismissOnEscape;
    closeDisabledRef.current = closeDisabled;
    initialFocusRefHolder.current = initialFocusRef;
  });

  // Manage modal stack, background inertness, scroll lock, initial focus, and focus restoration
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialogEl = dialogRef.current;
    pushModal({
      id: dialogId,
      backdropEl: backdropRef.current,
      dialogEl,
    });

    const preferredEl = initialFocusRefHolder.current?.current;
    if (preferredEl && typeof preferredEl.focus === 'function') {
      preferredEl.focus();
    } else if (dialogEl) {
      const focusables = getFocusableElements(dialogEl);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialogEl.focus();
      }
    }

    return () => {
      // Pop first so inert is removed from restoration targets before calling .focus()
      const { wasTop, nextTop } = popModal(dialogId);
      const elementToRestore = previousFocusRef.current;
      previousFocusRef.current = null;

      if (!nextTop) {
        if (
          elementToRestore &&
          elementToRestore.isConnected &&
          typeof elementToRestore.focus === 'function'
        ) {
          elementToRestore.focus();
        }
      } else if (wasTop) {
        const parentDialogEl = nextTop.dialogEl;
        if (
          elementToRestore &&
          elementToRestore.isConnected &&
          parentDialogEl?.contains(elementToRestore) &&
          typeof elementToRestore.focus === 'function'
        ) {
          elementToRestore.focus();
        } else if (parentDialogEl) {
          const parentFocusables = getFocusableElements(parentDialogEl);
          if (parentFocusables.length > 0) {
            parentFocusables[0].focus();
          } else {
            parentDialogEl.focus();
          }
        }
      }
    };
  }, [isOpen, dialogId]);

  // Keyboard handling (Escape dismissal and Tab/Shift+Tab focus containment for topmost modal)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopModal(dialogId)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (dismissOnEscapeRef.current && !closeDisabledRef.current) {
          onCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab') {
        const dialogEl = dialogRef.current;
        if (!dialogEl) return;

        const focusables = getFocusableElements(dialogEl);
        if (focusables.length === 0) {
          e.preventDefault();
          dialogEl.focus();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (!dialogEl.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }

        if (e.shiftKey) {
          if (active === first || active === dialogEl) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, dialogId]);

  if (!isOpen) {
    return null;
  }

  const handleBackdropMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    backdropMouseDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    const startedOnBackdrop = backdropMouseDownRef.current;
    backdropMouseDownRef.current = false;
    if (
      startedOnBackdrop &&
      e.target === e.currentTarget &&
      dismissOnBackdrop &&
      !closeDisabled
    ) {
      onClose();
    }
  };

  const handleCloseButtonClick = () => {
    if (!closeDisabled) {
      onClose();
    }
  };

  const resolvedCardStyle: CSSProperties = {
    ['--modal-max-width' as string]: maxWidth,
    ...cardStyle,
  };

  const dialogMarkup = (
    <div
      ref={backdropRef}
      className="mo modal-backdrop"
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className={`dlg modal-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={resolvedCardStyle}
      >
        <div className="modal-dialog-header">
          <div className="modal-dialog-title-wrap">
            {icon && (
              <span className="modal-dialog-icon" aria-hidden="true">
                {icon}
              </span>
            )}
            <h3 id={resolvedTitleId} className="modal-dialog-title">
              {title}
            </h3>
          </div>
          {showCloseButton && (
            <button
              type="button"
              className="ib sm modal-close-btn"
              onClick={handleCloseButtonClick}
              disabled={closeDisabled}
              aria-label={closeLabel}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {description && (
          <div id={descriptionId} className="modal-dialog-description">
            {description}
          </div>
        )}

        {children}
      </div>
    </div>
  );

  // Portal to document.body in browser runtimes so background siblings can be made inert cleanly
  if (typeof document !== 'undefined' && document.body) {
    return createPortal(dialogMarkup, document.body);
  }

  return dialogMarkup;
}
