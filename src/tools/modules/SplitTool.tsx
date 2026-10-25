// Tool module for extracting page ranges and splitting PDF documents.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Files, Info } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { getPdfPageCount, parsePageRanges, pdfProcessingService } from '../../core';
import type { PageRange } from '../../core';
import SplitRangeInput from './split/SplitRangeInput';

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
        <SplitRangeInput
          rangeInput={rangeInput}
          onRangeInputChange={setRangeInput}
          disabled={isProcessing || loadingPages}
          rangeValidation={rangeValidation}
          activeRanges={activeRanges}
        />
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
