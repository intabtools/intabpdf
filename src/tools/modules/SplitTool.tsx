import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Files, Info } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { getPdfPageCount, parsePageRanges, pdfProcessingService } from '../../core';
import type { PageRange } from '../../core';

export default function SplitTool({
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
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [rangeInput, setRangeInput] = useState('1-2');

  const file = stagedFiles[0];
  const isOnePerPage = optionsState['one-per-page'] ?? false;
  const loadingPages = !pageCount && !pageError && !!file?.bytes;

  // Determine the page count of the staged PDF document
  useEffect(() => {
    let active = true;

    if (file?.bytes) {
      void getPdfPageCount(file.bytes).then(
        (count) => {
          if (!active) return;
          setPageCount(count);
          // Default smart initial range based on document size
          if (count >= 4) {
            setRangeInput(`1-2, 3-${count}`);
          } else if (count >= 2) {
            setRangeInput('1, 2');
          } else {
            setRangeInput('1');
          }
        },
        (err: unknown) => {
          if (!active) return;
          setPageError(err instanceof Error ? err.message : 'Failed to inspect PDF');
        }
      );
    }

    return () => {
      active = false;
    };
  }, [file]);

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  // Real-time validation of requested page ranges
  const rangeValidation = useMemo(() => {
    if (pageCount === null || isOnePerPage) {
      return { ranges: [], omittedPages: [] };
    }
    return parsePageRanges(rangeInput, pageCount);
  }, [rangeInput, pageCount, isOnePerPage]);

  const activeRanges: PageRange[] = useMemo(() => {
    if (pageCount === null) return [];
    if (isOnePerPage) {
      const ranges: PageRange[] = [];
      for (let p = 1; p <= pageCount; p++) {
        ranges.push({ start: p, end: p });
      }
      return ranges;
    }
    return rangeValidation.ranges;
  }, [pageCount, isOnePerPage, rangeValidation.ranges]);

  const isValidToSplit =
    pageCount !== null &&
    !loadingPages &&
    !pageError &&
    (isOnePerPage || (!rangeValidation.error && activeRanges.length > 0));

  const handleRun = async () => {
    if (!isValidToSplit || !file) return;

    await onExecute(async () => {
      const cleanBase = (outputBaseName && outputBaseName.trim())
        ? outputBaseName.trim()
        : (defaultBaseName || file.name);
      return await pdfProcessingService.execute('split', {
        buffer: file.bytes,
        ranges: activeRanges,
        splitOptions: {
          baseName: cleanBase,
        },
      });
    });
  };

  return (
    <div className="card opts">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <b>Split options</b>
        {pageCount !== null && (
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
            {pageCount} {pageCount === 1 ? 'page' : 'pages'} total
          </span>
        )}
      </div>

      {pageError && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(232, 17, 35, 0.08)',
            border: '1px solid #E81123',
            color: '#E81123',
            fontSize: '13px',
            marginBottom: '12px',
          }}
          role="alert"
        >
          <AlertCircle size={16} />
          <span>{pageError}</span>
        </div>
      )}

      {/* Option: One file per page */}
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

      {/* Custom range input (when not in "one file per page" mode) */}
      {!isOnePerPage && (
        <div
          className="sw"
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '8px',
            marginTop: '8px',
          }}
        >
          <span style={{ width: '100%' }}>
            Page ranges to extract
            <small>Specify ranges separated by commas (e.g. 1-3, 4-6, 8)</small>
          </span>
          <input
            type="text"
            value={rangeInput}
            onChange={(e) => setRangeInput(e.target.value)}
            placeholder="e.g. 1-2, 3-5"
            disabled={isProcessing || loadingPages}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${rangeValidation.error ? '#E81123' : 'var(--border)'}`,
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
          />

          {rangeValidation.error ? (
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
              <span>{rangeValidation.error}</span>
            </div>
          ) : (
            activeRanges.length > 0 && (
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
                  Will create {activeRanges.length} {activeRanges.length === 1 ? 'file' : 'files'}:{' '}
                  {activeRanges
                    .map((r) => (r.start === r.end ? `page ${r.start}` : `pages ${r.start}-${r.end}`))
                    .join(', ')}
                </span>
              </div>
            )
          )}

          {rangeValidation.omittedPages && rangeValidation.omittedPages.length > 0 && !rangeValidation.error && (
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
              <span>
                Pages not in any range ({rangeValidation.omittedPages.join(', ')}) will be omitted from the output.
              </span>
            </div>
          )}
        </div>
      )}

      {isOnePerPage && pageCount !== null && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-2)',
            color: 'var(--text-muted)',
            fontSize: '13px',
            marginTop: '8px',
          }}
        >
          <Info size={16} />
          <span>Every page will be saved as an individual single-page PDF ({pageCount} files).</span>
        </div>
      )}

      <div style={{ marginTop: '10px', marginBottom: '4px' }}>
        <OutputFilenameInput
          value={outputBaseName ?? ''}
          onChange={onOutputBaseNameChange ?? (() => {})}
          placeholder={defaultBaseName ?? 'split-document'}
          extension={outputExtension ?? '.zip'}
          label="Output archive name"
        />
      </div>

      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={isProcessing || !isValidToSplit}
        style={{ marginTop: '12px' }}
      >
        <Files size={16} />
        <span>
          {isProcessing
            ? 'Splitting PDF...'
            : isOnePerPage
            ? `Split into ${pageCount || 0} files`
            : `Split into ${activeRanges.length} ${activeRanges.length === 1 ? 'file' : 'files'}`}
        </span>
      </button>
    </div>
  );
}
