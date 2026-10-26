// Sub-component for custom page range input and live validation feedback in SplitTool.
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { PageRange } from '../../../core';

export interface SplitRangeInputProps {
  rangeInput: string;
  onRangeInputChange: (val: string) => void;
  disabled: boolean;
  rangeValidation: {
    ranges: PageRange[];
    omittedPages?: number[];
    error?: string;
  };
  activeRanges: PageRange[];
}

export default function SplitRangeInput({
  rangeInput,
  onRangeInputChange,
  disabled,
  rangeValidation,
  activeRanges,
}: SplitRangeInputProps): ReactNode {
  return (
    <div
      className="sw"
      style={{
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '8px',
        marginTop: '8px',
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ width: '100%', minWidth: 0 }}>
        Page ranges to extract
        <small style={{ minWidth: 0, wordBreak: 'break-word' }}>
          Specify ranges separated by commas (e.g. 1-3, 4-6, 8)
        </small>
      </span>
      <input
        type="text"
        value={rangeInput}
        onChange={(e) => onRangeInputChange(e.target.value)}
        placeholder="e.g. 1-2, 3-5"
        disabled={disabled}
        style={{
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
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
            width: '100%',
            minWidth: 0,
          }}
          role="alert"
        >
          <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
          <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{rangeValidation.error}</span>
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
              width: '100%',
              minWidth: 0,
            }}
          >
            <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
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
            width: '100%',
            minWidth: 0,
          }}
        >
          <Info size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
          <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
            Pages not in any range ({rangeValidation.omittedPages.join(', ')}) will be omitted from the output.
          </span>
        </div>
      )}
    </div>
  );
}
