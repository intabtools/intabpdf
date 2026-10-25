// Sub-component for manual compression preset cards and explanatory details.
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import type { CompressionPreset } from '../../../core';
import { PRESET_CONFIG } from './compressConfig';

export interface QualityPresetSectionProps {
  preset: CompressionPreset;
  onPresetChange: (preset: CompressionPreset) => void;
}

export default function QualityPresetSection({
  preset,
  onPresetChange,
}: QualityPresetSectionProps): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', width: '100%' }}>
        {(['light', 'balanced', 'strong'] as const).map((p) => {
          const isSelected = preset === p;
          const conf = PRESET_CONFIG[p];
          const Icon = conf.icon;
          return (
            <button
              key={p}
              type="button"
              className="cta"
              onClick={() => onPresetChange(p)}
              style={{
                flexDirection: 'column',
                background: isSelected ? 'var(--text)' : 'var(--surface-2)',
                color: isSelected ? 'var(--background)' : 'var(--text)',
                border: isSelected ? '1px solid var(--text)' : '1px solid var(--border)',
                padding: '10px 8px',
                fontSize: '12px',
                fontWeight: 500,
                gap: '4px',
                alignItems: 'center',
                textAlign: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Icon size={14} />
                <span style={{ fontWeight: 600 }}>{conf.name}</span>
              </div>
              <span
                style={{
                  fontSize: '10px',
                  opacity: isSelected ? 0.9 : 0.7,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {conf.badge}
              </span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start',
          padding: '8px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-2)',
          color: 'var(--text-muted)',
          fontSize: '12px',
          lineHeight: 1.45,
        }}
      >
        <Info size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <b style={{ color: 'var(--text)', display: 'block', marginBottom: '2px' }}>
            {PRESET_CONFIG[preset].name} compression
          </b>
          <span>{PRESET_CONFIG[preset].details}</span>
        </div>
      </div>
    </div>
  );
}
