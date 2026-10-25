// Sub-component for target-size inputs and quick preset buttons in PDF compression.
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            id="target-size-input"
            type="number"
            min="1"
            step="any"
            value={targetValue}
            onChange={(e) => onTargetValueChange(e.target.value)}
            placeholder="e.g. 500"
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '14px',
              fontWeight: 600,
              outline: 'none',
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
            }}
          >
            <option value="KB">KB</option>
            <option value="MB">MB</option>
          </select>
        </div>
      </div>

      {/* Quick Target Presets */}
      <div>
        <span
          style={{
            display: 'block',
            fontSize: '11.5px',
            color: 'var(--text-muted)',
            marginBottom: '6px',
            fontWeight: 500,
          }}
        >
          Quick target presets
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {TARGET_PRESETS.map((p) => {
            const isActive = targetValue === p.value && targetUnit === p.unit;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onApplyPreset(p)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-pill)',
                  border: isActive ? '1px solid var(--text)' : '1px solid var(--border)',
                  background: isActive ? 'var(--text)' : 'var(--surface-2)',
                  color: isActive ? 'var(--background)' : 'var(--text)',
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
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
        }}
      >
        <Info size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          {file && targetBytes && targetBytes >= file.size ? (
            <span>
              The target size ({targetLabel}) is larger than the original file ({formatBytes(file.size)}).
              Structural stream packing will be applied without loss of image quality.
            </span>
          ) : (
            <span>
              Iteratively adjusts image downsampling and quality to reach your target of{' '}
              <strong style={{ color: 'var(--text)' }}>{targetLabel || 'specified size'}</strong>.
              Text, vector drawings, fonts, and page layouts are strictly preserved.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
