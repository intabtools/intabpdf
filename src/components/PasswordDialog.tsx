// Password prompt modal dialog for encrypted PDFs across Web, Desktop, and Android.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Lock } from 'lucide-react';
import ModalDialog from './ModalDialog';
import PasswordInput from './PasswordInput';

export interface PasswordDialogProps {
  fileName: string;
  isIncorrect: boolean;
  isSubmitting: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export default function PasswordDialog({
  fileName,
  isIncorrect,
  isSubmitting,
  onSubmit,
  onCancel,
}: PasswordDialogProps): ReactNode {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select input on mount and after each incorrect attempt
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => clearTimeout(timer);
  }, [isIncorrect]);

  const handleSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = password;
    if (!trimmed || isSubmitting) return;
    onSubmit(trimmed);
    setPassword('');
  };

  return (
    <ModalDialog
      isOpen={true}
      onClose={onCancel}
      title="Password Protected PDF"
      titleId="password-dialog-title"
      icon={<Lock size={20} color="var(--accent)" />}
      description={
        <span>
          This document is encrypted. Enter the password to open{' '}
          <strong style={{ color: 'var(--text)', wordBreak: 'break-all' }}>
            {fileName || 'this file'}
          </strong>
          .
        </span>
      }
      dismissOnEscape={!isSubmitting}
      dismissOnBackdrop={!isSubmitting}
      closeDisabled={isSubmitting}
      closeLabel="Cancel"
      initialFocusRef={inputRef}
      maxWidth="440px"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <PasswordInput
          ref={inputRef}
          id="pdf-password-input"
          label="Password:"
          labelStyle={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--text-muted)',
            marginBottom: '6px',
          }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isSubmitting}
          autoComplete="off"
          placeholder="Enter document password"
          variant="surface-2"
          inputStyle={{
            padding: '9px 44px 9px 12px',
            fontSize: '13.5px',
          }}
          toggleTabIndex={-1}
          error={isIncorrect ? 'Incorrect password. Please try again.' : undefined}
        />

        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginTop: '4px',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="btn btn-secondary"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={isSubmitting || !password.trim()}
            className="btn btn-primary"
            style={{ minWidth: '100px' }}
          >
            {isSubmitting ? 'Unlocking…' : 'Unlock PDF'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
