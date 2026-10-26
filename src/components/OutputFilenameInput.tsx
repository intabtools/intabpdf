import type { ReactNode } from 'react';

export interface OutputFilenameInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  extension: '.pdf' | '.zip' | string;
  label?: string;
  compact?: boolean;
  className?: string;
}

export default function OutputFilenameInput({
  id = 'output-filename-input',
  value,
  onChange,
  placeholder,
  extension,
  label = 'Output file name',
  compact = false,
  className = '',
}: OutputFilenameInputProps): ReactNode {
  return (
    <div
      className={`output-filename-group ${className}`}
      style={{
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        alignItems: compact ? 'center' : 'stretch',
        gap: compact ? '8px' : '6px',
        width: '100%',
      }}
    >
      {label && (
        <label
          htmlFor={id}
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </label>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '2px 8px',
          boxSizing: 'border-box',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: 'transparent',
            color: 'var(--text)',
            fontSize: '13px',
            fontFamily: 'var(--font-mono)',
            padding: '7px 4px',
            outline: 'none',
          }}
        />
        <span
          style={{
            color: 'var(--text-muted)',
            fontSize: '13px',
            fontFamily: 'var(--font-mono)',
            userSelect: 'none',
            paddingLeft: '4px',
            flexShrink: 0,
            fontWeight: 600,
          }}
        >
          {extension}
        </span>
      </div>
    </div>
  );
}
