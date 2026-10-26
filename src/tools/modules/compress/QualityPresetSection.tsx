// Sub-component for manual compression preset cards and explanatory details.
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import type { CompressionPreset } from '../../../core';
import { PRESET_CARDS } from './compressConfig';

export interface QualityPresetSectionProps {
  preset: CompressionPreset;
  onPresetChange: (preset: CompressionPreset) => void;
}

export default function QualityPresetSection({
  preset,
  onPresetChange,
}: QualityPresetSectionProps): ReactNode {
  // Normalize preset to one of the 3 card IDs
  const activePresetId =
    preset === 'strong' || preset === 'smaller'
      ? 'smaller'
      : preset === 'light' || preset === 'high-quality'
      ? 'high-quality'
      : 'recommended';

  const activeConf =
    PRESET_CARDS.find((c) => c.id === activePresetId) || PRESET_CARDS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, width: '100%' }}>
      <div
        role="radiogroup"
        aria-label="Compression quality presets"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 90px), 1fr))',
          gap: '8px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {PRESET_CARDS.map((conf) => {
          const isSelected = activePresetId === conf.id;
          const Icon = conf.icon;
          return (
            <button
              key={conf.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onPresetChange(conf.corePreset || 'recommended')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                background: isSelected ? 'var(--text)' : 'var(--surface-2)',
                color: isSelected ? 'var(--background)' : 'var(--text)',
                border: isSelected ? '1px solid var(--text)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 6px',
                fontSize: '12px',
                fontWeight: 500,
                gap: '4px',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                minHeight: '68px',
                minWidth: 0,
                width: '100%',
                boxSizing: 'border-box',
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, maxWidth: '100%' }}>
                <Icon size={14} style={{ flexShrink: 0 }} />
                <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conf.name}</span>
              </div>
              <span
                style={{
                  fontSize: '10px',
                  opacity: isSelected ? 0.95 : 0.75,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
              >
                {conf.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Preset Details & Strategy Summary */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
          <div style={{ minWidth: 0, wordBreak: 'break-word' }}>
            <b style={{ color: 'var(--text)', display: 'inline', marginRight: '6px' }}>
              {activeConf.name}:
            </b>
            <span>{activeConf.details}</span>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontWeight: 500,
              color: 'var(--text)',
              marginTop: '2px',
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '2px 6px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                maxWidth: '100%',
                wordBreak: 'break-word',
              }}
            >
              {activeConf.strategySummary}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
