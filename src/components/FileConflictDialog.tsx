// Confirmation dialog modal and provider for Android file conflict protection.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalDialog from './ModalDialog';
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
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
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
        <ModalDialog
          isOpen={true}
          onClose={handleCancel}
          title="File already exists"
          titleId="conflict-dialog-title"
          icon={<AlertTriangle size={20} color="var(--warning)" />}
          description={
            <span>
              A file named{' '}
              <strong style={{ color: 'var(--text)', wordBreak: 'break-all' }}>
                {conflict.fileName}
              </strong>{' '}
              already exists in your Documents folder.
            </span>
          }
          closeLabel="Cancel"
          initialFocusRef={inputRef}
          maxWidth="460px"
        >
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
                  border: `1px solid ${nameError ? 'var(--danger)' : 'var(--border)'}`,
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontSize: '13px',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
              {nameError && (
                <span style={{ fontSize: '11.5px', color: 'var(--danger)' }}>
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
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                Save as new name
              </button>

              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                <button
                  type="button"
                  onClick={handleReplace}
                  className="btn btn-danger-soft"
                  style={{ flex: 1 }}
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </ModalDialog>
      )}
    </>
  );
}
