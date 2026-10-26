// Sub-component for target-size inputs and quick preset buttons in PDF compression.
import type { ReactNode } from 'react';
import { AlertCircle, Info } from 'lucide-react';
import type { StagedFile } from '../../types';
import { formatBytes } from '../../../core/formatBytes';
import { TARGET_PRESETS, type TargetPreset } from './compressConfig';

export interface TargetSizeSectionProps {
  file: StagedFile | undefined;
  targetValue: string;
  onTargetValueChange: (val: string) => void;
  targetUnit: 'KB' | 'MB';
  onTargetUnitChange: (unit: 'KB' | 'MB') => void;
  targetBytes: number | null;
  targetLabel: string | null;
  onApplyPreset: (preset: TargetPreset) => void;
}

export default function TargetSizeSection({
  file,
  targetValue,
  onTargetValueChange,
  targetUnit,
  onTargetUnitChange,
  targetBytes,
  targetLabel,
  onApplyPreset,
}: TargetSizeSectionProps): ReactNode {
  const numericVal = parseFloat(targetValue);
  const isValid = !isNaN(numericVal) && numericVal > 0;
  const isTooSmall = isValid && targetBytes !== null && targetBytes < 30 * 1024;
  const isLargerThanOriginal = Boolean(file && targetBytes && targetBytes >= file.size);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0, width: '100%' }}>
      <div>
        <label
          htmlFor="target-size-input"
          style={{
            display: 'block',
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: '6px',
          }}
        >
          Desired output size
        </label>

        {/* Input & Unit Selector Group */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0, width: '100%' }}>
          <input
            id="target-size-input"
            type="number"
            min="1"
            step="any"
            value={targetValue}
            onChange={(e) => onTargetValueChange(e.target.value)}
            placeholder="e.g. 500"
            aria-invalid={!isValid}
            aria-describedby={!isValid ? 'target-size-error' : 'target-size-hint'}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm)',
              border: !isValid ? '1px solid var(--accent, #d83b01)' : '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '14px',
              fontWeight: 600,
              outline: 'none',
              minHeight: '42px',
              boxSizing: 'border-box',
            }}
          />
          <select
            aria-label="Target size unit"
            value={targetUnit}
            onChange={(e) => onTargetUnitChange(e.target.value as 'KB' | 'MB')}
            style={{
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none',
              minHeight: '42px',
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
          >
            <option value="KB">KB</option>
            <option value="MB">MB</option>
          </select>
        </div>

        {/* Validation error message */}
        {!isValid && (
          <div
            id="target-size-error"
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--accent, #d83b01)',
              fontSize: '12px',
              marginTop: '6px',
              fontWeight: 500,
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>Please enter a valid target size greater than 0.</span>
          </div>
        )}
      </div>

      {/* Quick Target Presets */}
      <div style={{ minWidth: 0, width: '100%' }}>
        <span
          style={{
            display: 'block',
            fontSize: '11.5px',
            color: 'var(--text-muted)',
            marginBottom: '6px',
            fontWeight: 500,
          }}
        >
          Quick target sizes
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', minWidth: 0, maxWidth: '100%' }}>
          {TARGET_PRESETS.map((p) => {
            const isActive = targetValue === p.value && targetUnit === p.unit;
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={isActive}
                aria-label={`Set target to ${p.label}`}
                onClick={() => onApplyPreset(p)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 'var(--radius-pill)',
                  border: isActive ? '1px solid var(--text)' : '1px solid var(--border)',
                  background: isActive ? 'var(--text)' : 'var(--surface-2)',
                  color: isActive ? 'var(--background)' : 'var(--text)',
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  minHeight: '34px',
                  boxSizing: 'border-box',
                  transition: 'all 0.12s',
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Target Feasibility & Process Guidance */}
      <div
        id="target-size-hint"
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start',
          padding: '10px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-2)',
          color: 'var(--text-muted)',
          fontSize: '12px',
          lineHeight: 1.45,
          minWidth: 0,
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <Info size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div style={{ minWidth: 0, flex: 1, wordBreak: 'break-word' }}>
          {isLargerThanOriginal ? (
            <span>
              The requested target ({targetLabel}) is larger than the original file ({formatBytes(file!.size)}).
              Stream packing will be applied without loss of image quality.
            </span>
          ) : isTooSmall ? (
            <span>
              Target size is very small ({targetLabel}). PDFs require structural overhead for fonts, page tables,
              and cross-reference indices, so this target may not be reachable without losing content.
            </span>
          ) : (
            <span>
              Iteratively adjusts image downsampling and quality to approach your target of{' '}
              <strong style={{ color: 'var(--text)' }}>{targetLabel || 'specified size'}</strong>.
              Text, vector drawings, fonts, and page layouts are strictly preserved.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
