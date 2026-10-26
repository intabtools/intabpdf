// Confirmation dialog modal and provider for Android file conflict protection.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  setConflictPromptHandler,
  type ConflictResolution,
} from '../platform/conflictDialog';

interface ActiveConflict {
  fileName: string;
  suggestedName: string;
  resolve: (res: ConflictResolution) => void;
}

export function FileConflictProvider({ children }: { children: ReactNode }): ReactNode {
  const [conflict, setConflict] = useState<ActiveConflict | null>(null);
  const [customName, setCustomName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConflictPromptHandler((fileName, suggestedName) => {
      return new Promise<ConflictResolution>((resolve) => {
        setCustomName(suggestedName);
        setNameError(null);
        setConflict({
          fileName,
          suggestedName,
          resolve: (res) => {
            setConflict(null);
            resolve(res);
          },
        });
      });
    });

    return () => {
      setConflictPromptHandler(null);
    };
  }, []);

  useEffect(() => {
    if (conflict) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          conflict.resolve({ action: 'cancel' });
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [conflict]);

  const handleReplace = () => {
    conflict?.resolve({ action: 'replace' });
  };

  const handleCancel = () => {
    conflict?.resolve({ action: 'cancel' });
  };

  const handleSaveAsNew = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = customName.trim();
    if (!trimmed) {
      setNameError('Please enter a valid filename.');
      return;
    }
    conflict?.resolve({ action: 'rename', newFileName: trimmed });
  };

  return (
    <>
      {children}
      {conflict && (
        <div
          className="mo"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancel();
          }}
          style={{ zIndex: 10000 }}
        >
          <div
            className="dlg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-dialog-title"
            style={{
              padding: '20px',
              maxWidth: '460px',
              width: '92vw',
              margin: 'auto',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.36)',
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
                <AlertTriangle size={20} color="#eab308" />
                <h3
                  id="conflict-dialog-title"
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  File already exists
                </h3>
              </div>
              <button
                type="button"
                className="ib sm"
                onClick={handleCancel}
                aria-label="Cancel"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
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
              A file named{' '}
              <strong style={{ color: 'var(--text)', wordBreak: 'break-all' }}>
                {conflict.fileName}
              </strong>{' '}
              already exists in your Documents folder.
            </p>

            <form onSubmit={handleSaveAsNew} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label
                  htmlFor="new-filename-input"
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--text-muted)',
                  }}
                >
                  Save as new name:
                </label>
                <input
                  ref={inputRef}
                  id="new-filename-input"
                  type="text"
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${nameError ? '#ef4444' : 'var(--border)'}`,
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontSize: '13px',
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />
                {nameError && (
                  <span style={{ fontSize: '11.5px', color: '#ef4444' }}>
                    {nameError}
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  marginTop: '8px',
                }}
              >
                <button
                  type="submit"
                  className="cta"
                  style={{
                    width: '100%',
                    padding: '9px 14px',
                    fontSize: '13px',
                    justifyContent: 'center',
                  }}
                >
                  Save as new name
                </button>

                <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                  <button
                    type="button"
                    onClick={handleReplace}
                    className="vtb-btn"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: '12.5px',
                      justifyContent: 'center',
                      background: 'rgba(239, 68, 68, 0.1)',
                      borderColor: 'rgba(239, 68, 68, 0.3)',
                      color: '#ef4444',
                    }}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="vtb-btn"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: '12.5px',
                      justifyContent: 'center',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
