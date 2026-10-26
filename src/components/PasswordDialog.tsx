// Password prompt modal dialog for encrypted PDFs across Web, Desktop, and Android.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AlertTriangle, Eye, EyeOff, Lock, X } from 'lucide-react';

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
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select input on mount and after each incorrect attempt
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => clearTimeout(timer);
  }, [isIncorrect]);

  // Handle keyboard shortcuts (Escape to cancel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onCancel]);

  const handleSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = password;
    if (!trimmed || isSubmitting) return;
    onSubmit(trimmed);
    setPassword('');
  };

  return (
    <div
      className="mo"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onCancel();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-dialog-title"
        style={{
          padding: '22px',
          maxWidth: '440px',
          width: '100%',
          margin: 'auto',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Lock size={20} color="var(--accent)" />
            <h3
              id="password-dialog-title"
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text)',
              }}
            >
              Password Protected PDF
            </h3>
          </div>
          <button
            type="button"
            className="ib sm"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Cancel"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              padding: '4px',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <p
          style={{
            margin: '0 0 16px',
            fontSize: '13.5px',
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          This document is encrypted. Enter the password to open{' '}
          <strong style={{ color: 'var(--text)', wordBreak: 'break-all' }}>
            {fileName || 'this file'}
          </strong>
          .
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label
              htmlFor="pdf-password-input"
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--text-muted)',
              }}
            >
              Password:
            </label>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                ref={inputRef}
                id="pdf-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                disabled={isSubmitting}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                placeholder="Enter document password"
                style={{
                  padding: '9px 38px 9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${isIncorrect ? '#ef4444' : 'var(--border)'}`,
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontSize: '13.5px',
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {isIncorrect && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#ef4444',
                  fontSize: '12px',
                  marginTop: '2px',
                }}
              >
                <AlertTriangle size={14} />
                <span>Incorrect password. Please try again.</span>
              </div>
            )}
          </div>

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
              className="vtb-btn"
              style={{
                padding: '8px 14px',
                fontSize: '13px',
                justifyContent: 'center',
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !password.trim()}
              className="cta"
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                justifyContent: 'center',
                minWidth: '100px',
              }}
            >
              {isSubmitting ? 'Unlocking…' : 'Unlock PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
