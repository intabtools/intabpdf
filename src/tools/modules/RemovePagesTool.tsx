// Tool module for removing specific pages and page ranges from a PDF.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Trash2 } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import ModalDialog from '../../components/ModalDialog';
import type { ToolComponentProps } from '../types';
import { parseRemovePageInput } from '../../core/remove-pages';
import { getPdfPageCount } from '../../core/split';
import { pdfProcessingService } from '../../core/worker/service';

export default function RemovePagesTool({
  tool,
  stagedFiles,
  optionsState,
  onOptionsChange,
  onExecute,
  isProcessing,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const [removePagesInput, setRemovePagesInput] = useState('');
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const file = stagedFiles[0];

  useEffect(() => {
    let active = true;

    if (file?.bytes) {
      void getPdfPageCount(file.bytes).then(
        (count) => {
          if (!active) return;
          setPageCount(count);
          setPageError(null);
        },
        (err: unknown) => {
          if (!active) return;
          setPageError(err instanceof Error ? err.message : 'Failed to inspect PDF');
          setPageCount(null);
        }
      );
    }

    return () => {
      active = false;
    };
  }, [file]);

  // Handle keyboard shortcuts (Escape to dismiss confirmation modal)
  useEffect(() => {
    if (!showConfirmModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) {
        e.preventDefault();
        setShowConfirmModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showConfirmModal, isProcessing]);

  const effectivePageCount = file?.bytes ? pageCount : null;
  const effectivePageError = file?.bytes ? pageError : null;

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const validation = useMemo(() => {
    if (effectivePageCount === null) return null;
    return parseRemovePageInput(removePagesInput, effectivePageCount);
  }, [removePagesInput, effectivePageCount]);

  const isValidToRemove =
    Boolean(file) &&
    effectivePageCount !== null &&
    !effectivePageError &&
    Boolean(validation) &&
    !validation?.error &&
    (validation?.indices.length ?? 0) > 0;

  const executeRemoval = async () => {
    setShowConfirmModal(false);
    if (!isValidToRemove || !file || !validation || validation.indices.length === 0) return;

    await onExecute(async (signal) => {
      return await pdfProcessingService.execute(
        'remove-pages',
        {
          buffer: file.bytes,
          pageIndices: validation.indices,
        },
        { signal }
      );
    });
  };

  const handleRunClick = () => {
    if (!isValidToRemove || !file || !validation || validation.indices.length === 0) return;

    const requireConfirm = optionsState['confirm'] ?? true;
    if (requireConfirm) {
      setShowConfirmModal(true);
    } else {
      void executeRemoval();
    }
  };

  return (
    <div className="card opts">
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        <span style={{ width: '100%', minWidth: 0 }}>
          Page numbers or ranges to remove
          <small style={{ minWidth: 0, wordBreak: 'break-word' }}>
            {effectivePageCount !== null
              ? `Document has ${effectivePageCount} ${effectivePageCount === 1 ? 'page' : 'pages'}. Enter page numbers or ranges (e.g. 1-3, 5)`
              : 'Enter page numbers or ranges (e.g. 1-3, 5)'}
          </small>
        </span>
        <input
          type="text"
          value={removePagesInput}
          onChange={(e) => setRemovePagesInput(e.target.value)}
          placeholder="e.g. 1-3, 5"
          style={{
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            border:
              removePagesInput.trim().length > 0 && validation?.error
                ? '1px solid var(--danger)'
                : '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            boxSizing: 'border-box',
          }}
        />

        {effectivePageCount === 1 && (
          <div
            style={{
              display: 'flex',
              gap: '6px',
              alignItems: 'flex-start',
              color: 'var(--text-muted)',
              fontSize: '12px',
              lineHeight: '1.4',
              width: '100%',
              minWidth: 0,
            }}
          >
            <Info size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
            <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
              This document has only 1 page. A PDF must have at least one remaining page, so pages cannot be removed.
            </span>
          </div>
        )}

        {effectivePageError && (
          <div
            style={{
              display: 'flex',
              gap: '6px',
              alignItems: 'flex-start',
              color: 'var(--danger)',
              fontSize: '12px',
              lineHeight: '1.4',
              width: '100%',
              minWidth: 0,
            }}
            role="alert"
          >
            <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
            <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{effectivePageError}</span>
          </div>
        )}

        {!effectivePageError && effectivePageCount !== null && effectivePageCount > 1 && (
          <>
            {removePagesInput.trim().length > 0 && validation?.error ? (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'flex-start',
                  color: 'var(--danger)',
                  fontSize: '12px',
                  lineHeight: '1.4',
                  width: '100%',
                  minWidth: 0,
                }}
                role="alert"
              >
                <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{validation.error}</span>
              </div>
            ) : validation && validation.pageNumbers.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  color: 'var(--accent)',
                  fontSize: '12px',
                  width: '100%',
                  minWidth: 0,
                }}
              >
                <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
                  Will remove {validation.pageNumbers.length}{' '}
                  {validation.pageNumbers.length === 1 ? 'page' : 'pages'} (
                  {validation.pageNumbers.join(', ')}). {validation.remainingCount}{' '}
                  {validation.remainingCount === 1 ? 'page' : 'pages'} will remain.
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'flex-start',
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  lineHeight: '1.4',
                  width: '100%',
                  minWidth: 0,
                }}
              >
                <Info size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
                  Enter page numbers or ranges like 1-3, 5 to select pages for removal.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {tool.options.map((opt) => {
        const checked = optionsState[opt.id] ?? opt.defaultValue;
        return (
          <div key={opt.id} className="sw">
            <span>
              {opt.label}
              <small>{opt.description}</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={checked}
              aria-label={opt.label}
              className={`tg ${checked ? 'on' : ''}`}
              onClick={() => toggleOption(opt.id)}
            />
          </div>
        );
      })}

      <div style={{ marginTop: '6px', marginBottom: '8px', width: '100%', minWidth: 0, maxWidth: '100%' }}>
        <OutputFilenameInput
          value={outputBaseName ?? ''}
          onChange={onOutputBaseNameChange ?? (() => {})}
          placeholder={defaultBaseName ?? 'edited-document'}
          extension={outputExtension ?? '.pdf'}
        />
      </div>

      <button
        type="button"
        className="cta"
        onClick={handleRunClick}
        disabled={isProcessing || !isValidToRemove}
      >
        <Trash2 size={16} style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.3 }}>
          {isProcessing ? 'Removing...' : 'Remove pages from file'}
        </span>
      </button>

      {showConfirmModal && validation && file && (
        <ModalDialog
          isOpen={true}
          onClose={() => {
            if (!isProcessing) {
              setShowConfirmModal(false);
            }
          }}
          title="Confirm Page Removal"
          titleId="confirm-remove-title"
          icon={<Trash2 size={20} color="var(--danger)" />}
          description={
            <>
              Are you sure you want to remove{' '}
              <strong style={{ color: 'var(--text)' }}>
                {validation.pageNumbers.length} {validation.pageNumbers.length === 1 ? 'page' : 'pages'} (
                {validation.pageNumbers.join(', ')})
              </strong>{' '}
              from <strong style={{ color: 'var(--text)' }}>{file.name}</strong>?
              <br />
              {validation.remainingCount} {validation.remainingCount === 1 ? 'page' : 'pages'} will remain.
            </>
          }
          dismissOnEscape={!isProcessing}
          dismissOnBackdrop={!isProcessing}
          closeDisabled={isProcessing}
          closeLabel="Cancel"
          maxWidth="440px"
        >
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowConfirmModal(false)}
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void executeRemoval()}
              disabled={isProcessing}
            >
              {isProcessing ? 'Removing...' : 'Confirm removal'}
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
