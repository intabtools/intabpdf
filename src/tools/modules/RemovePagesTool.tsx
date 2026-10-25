import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Trash2 } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { getPdfPageCount, parseRemovePageInput, pdfProcessingService } from '../../core';

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

  const handleRun = async () => {
    if (!isValidToRemove || !file || !validation || validation.indices.length === 0) return;

    await onExecute(async () => {
      return await pdfProcessingService.execute('remove-pages', {
        buffer: file.bytes,
        pageIndices: validation.indices,
      });
    });
  };

  return (
    <div className="card opts">
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
        }}
      >
        <span>
          Page numbers or ranges to remove
          <small>
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
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            border: validation?.error
              ? '1px solid #E81123'
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
            }}
          >
            <Info size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
            <span>This document has only 1 page. A PDF must have at least one remaining page, so pages cannot be removed.</span>
          </div>
        )}

        {effectivePageError && (
          <div
            style={{
              display: 'flex',
              gap: '6px',
              alignItems: 'flex-start',
              color: '#E81123',
              fontSize: '12px',
              lineHeight: '1.4',
            }}
            role="alert"
          >
            <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
            <span>{effectivePageError}</span>
          </div>
        )}

        {!effectivePageError && effectivePageCount !== null && effectivePageCount > 1 && (
          <>
            {validation?.error ? (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'flex-start',
                  color: '#E81123',
                  fontSize: '12px',
                  lineHeight: '1.4',
                }}
                role="alert"
              >
                <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>{validation.error}</span>
              </div>
            ) : validation && validation.pageNumbers.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  color: 'var(--accent)',
                  fontSize: '12px',
                }}
              >
                <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                <span>
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
                }}
              >
                <Info size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>Enter page numbers or ranges like 1-3, 5 to select pages for removal.</span>
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

      <div style={{ marginTop: '6px', marginBottom: '8px' }}>
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
        onClick={handleRun}
        disabled={isProcessing || !isValidToRemove}
      >
        <Trash2 size={16} />
        <span>
          {isProcessing ? 'Removing...' : 'Remove pages from file'}
        </span>
      </button>
    </div>
  );
}
