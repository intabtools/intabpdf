// Tool module for rotating PDF pages in 90-degree increments.
import { useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, RotateCw } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import { ProcessingContext } from '../../components/processingContextDef';
import type { ToolComponentProps } from '../types';
import { getPdfPageCount, parseRotatePageInput, pdfProcessingService } from '../../core';
import { executeBatchOperation } from '../batchOperation';
import { getCleanBaseName } from '../filename';

export default function RotateTool({
  tool,
  stagedFiles,
  optionsState,
  onOptionsChange,
  onExecute,
  isProcessing,
  onExtraStateChange,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const processing = useContext(ProcessingContext);
  const [pagesInput, setPagesInput] = useState('');
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const file = stagedFiles[0];
  const isMultiFile = stagedFiles.length > 1;

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

  const allPages = optionsState['all-pages'] ?? true;
  const isCw = optionsState['cw'] ?? true;

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const validation = useMemo(() => {
    if (allPages || pageCount === null) return null;
    return parseRotatePageInput(pagesInput, pageCount);
  }, [allPages, pagesInput, pageCount]);

  const isSelectionValid =
    allPages ||
    (Boolean(validation) && !validation?.error && (validation?.indices.length ?? 0) > 0);

  const canExecute =
    stagedFiles.length > 0 &&
    (isMultiFile || !pageError) &&
    !isProcessing &&
    isSelectionValid;

  const handleRun = async () => {
    if (!canExecute || stagedFiles.length === 0) return;

    const abortController = isMultiFile ? new AbortController() : null;
    if (abortController) {
      processing?.setCancelHandler?.(() => {
        abortController.abort();
      });
    }

    try {
      await onExecute(async () => {
        if (stagedFiles.length === 1) {
          const pageIndices = !allPages && validation ? validation.indices : undefined;
          return await pdfProcessingService.execute('rotate', {
            buffer: stagedFiles[0].bytes,
            options: {
              clockwise: isCw,
              allPages,
              pageIndices,
            },
          });
        }

        return await executeBatchOperation({
          actionVerb: 'Rotating',
          stagedFiles,
          updateMessage: processing?.updateMessage,
          onExtraStateChange,
          signal: abortController?.signal,
          processFile: async (curFile) => {
            let pageIndices: number[] | undefined;
            if (!allPages) {
              const docPageCount = await getPdfPageCount(curFile.bytes);
              const parsed = parseRotatePageInput(pagesInput, docPageCount);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              pageIndices = parsed.indices;
            }

            const rotatedBytes = await pdfProcessingService.execute('rotate', {
              buffer: curFile.bytes,
              options: {
                clockwise: isCw,
                allPages,
                pageIndices,
              },
            });

            const cleanBase = getCleanBaseName(curFile.name) || 'document';
            return {
              name: `rotated-${cleanBase}.pdf`,
              bytes: rotatedBytes,
            };
          },
        });
      });
    } finally {
      if (isMultiFile) {
        processing?.setCancelHandler?.(null);
      }
    }
  };

  const ctaLabel = isProcessing
    ? stagedFiles.length > 1
      ? `Rotating ${stagedFiles.length} files...`
      : 'Rotating...'
    : stagedFiles.length > 1
      ? allPages
        ? `Rotate all pages (${stagedFiles.length} files)`
        : validation && validation.indices.length > 0
          ? `Rotate ${validation.indices.length} ${validation.indices.length === 1 ? 'page' : 'pages'} (${stagedFiles.length} files)`
          : `Rotate selected pages (${stagedFiles.length} files)`
      : allPages
        ? 'Rotate all pages'
        : validation && validation.indices.length > 0
          ? `Rotate ${validation.indices.length} ${validation.indices.length === 1 ? 'page' : 'pages'}`
          : 'Rotate selected pages';

  return (
    <div className="card opts">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <b>{tool.name} options</b>
        {stagedFiles.length > 1 && (
          <span
            style={{
              fontSize: '12px',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-2)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {`${stagedFiles.length} files selected`}
          </span>
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

      {!allPages && (
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
            Pages or ranges to rotate
            <small style={{ minWidth: 0, wordBreak: 'break-word' }}>
              {pageCount !== null
                ? `Document has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}. Enter page numbers or ranges (e.g. 1-3, 5)`
                : 'Enter page numbers or ranges (e.g. 1-3, 5)'}
            </small>
          </span>
          <input
            type="text"
            value={pagesInput}
            onChange={(e) => setPagesInput(e.target.value)}
            placeholder="e.g. 1-3, 5"
            style={{
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
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

          {pageError && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
                alignItems: 'flex-start',
                color: '#E81123',
                fontSize: '12px',
                lineHeight: '1.4',
                width: '100%',
                minWidth: 0,
              }}
              role="alert"
            >
              <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{pageError}</span>
            </div>
          )}

          {!pageError && pageCount !== null && (
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
                    Will rotate {validation.pageNumbers.length}{' '}
                    {validation.pageNumbers.length === 1 ? 'page' : 'pages'} (
                    {validation.pageNumbers.join(', ')}).
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
                    Enter page numbers or ranges like 1-3, 5 to select specific pages.
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: '6px', marginBottom: '8px', width: '100%', minWidth: 0, maxWidth: '100%' }}>
        <OutputFilenameInput
          value={outputBaseName ?? ''}
          onChange={onOutputBaseNameChange ?? (() => {})}
          placeholder={defaultBaseName ?? 'rotated-document'}
          extension={outputExtension ?? '.pdf'}
        />
      </div>

      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={!canExecute}
      >
        <RotateCw size={16} style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.3 }}>
          {ctaLabel}
        </span>
      </button>
    </div>
  );
}
