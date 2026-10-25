import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FileDown, Gauge, Info, Sparkles, Target, Zap } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { pdfProcessingService } from '../../core';
import type { CompressionPreset } from '../../core';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  return Math.round(bytes / 1024) + ' KB';
}

interface TargetPreset {
  label: string;
  value: string;
  unit: 'KB' | 'MB';
  bytes: number;
}

const TARGET_PRESETS: TargetPreset[] = [
  { label: '100 KB', value: '100', unit: 'KB', bytes: 100 * 1024 },
  { label: '200 KB', value: '200', unit: 'KB', bytes: 200 * 1024 },
  { label: '500 KB', value: '500', unit: 'KB', bytes: 500 * 1024 },
  { label: '1 MB', value: '1', unit: 'MB', bytes: 1024 * 1024 },
  { label: '2 MB', value: '2', unit: 'MB', bytes: 2 * 1024 * 1024 },
];

const PRESET_CONFIG: Record<
  CompressionPreset,
  {
    name: string;
    badge: string;
    icon: typeof Zap;
    description: string;
    details: string;
  }
> = {
  light: {
    name: 'Light',
    badge: 'Lossless',
    icon: Sparkles,
    description: 'Compresses PDF structure & streams',
    details: 'Packs cross-reference tables and streams. 100% original photo resolution preserved.',
  },
  balanced: {
    name: 'Balanced',
    badge: 'Recommended',
    icon: Gauge,
    description: 'Optimal size-to-quality balance',
    details: 'Re-encodes photos at 70% quality, downsamples above 1600px. Text and vectors remain crisp.',
  },
  strong: {
    name: 'Strong',
    badge: 'Smallest',
    icon: Zap,
    description: 'Maximum file size reduction',
    details: 'Aggressively compresses photos at 50% quality, downsamples above 1024px. Ideal for email limits.',
  },
};

export default function CompressTool({
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
  const file = stagedFiles[0];

  // Primary mode: 'target' (Compress to target file size) vs 'preset' (Manual quality presets)
  const [mode, setMode] = useState<'target' | 'preset'>('target');

  // Target size inputs
  const [targetValue, setTargetValue] = useState<string>(() => {
    if (!file) return '500';
    // Sensible initial target based on input file size
    if (file.size > 2 * 1024 * 1024) return '1';
    if (file.size > 800 * 1024) return '500';
    if (file.size > 300 * 1024) return '200';
    return '100';
  });
  const [targetUnit, setTargetUnit] = useState<'KB' | 'MB'>(() => {
    return file && file.size > 2 * 1024 * 1024 ? 'MB' : 'KB';
  });

  // Manual preset selection if user switches to preset mode
  const [preset, setPreset] = useState<CompressionPreset>('balanced');

  // Compute numeric target bytes from current inputs
  const numericVal = parseFloat(targetValue);
  const targetBytes =
    !isNaN(numericVal) && numericVal > 0
      ? Math.round(targetUnit === 'MB' ? numericVal * 1024 * 1024 : numericVal * 1024)
      : null;

  const targetLabel = targetBytes ? `${targetValue} ${targetUnit}` : null;

  // Keep parent ToolPage informed of active target so results card can format target metrics
  useEffect(() => {
    if (mode === 'target') {
      onExtraStateChange?.('targetBytes', targetBytes);
      onExtraStateChange?.('targetLabel', targetLabel);
    } else {
      onExtraStateChange?.('targetBytes', undefined);
      onExtraStateChange?.('targetLabel', undefined);
    }
  }, [mode, targetBytes, targetLabel, onExtraStateChange]);

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const handleApplyPreset = (p: TargetPreset) => {
    setTargetValue(p.value);
    setTargetUnit(p.unit);
  };

  const handleRun = async () => {
    if (!file || isProcessing) return;

    if (mode === 'target' && (!targetBytes || targetBytes <= 0)) {
      return;
    }

    onExtraStateChange?.('targetBytes', mode === 'target' ? targetBytes : undefined);
    onExtraStateChange?.('targetLabel', mode === 'target' ? targetLabel : undefined);

    await onExecute(async () => {
      return await pdfProcessingService.execute('compress', {
        buffer: file.bytes,
        options: {
          targetBytes: mode === 'target' ? (targetBytes ?? undefined) : undefined,
          preset: mode === 'preset' ? preset : undefined,
          downsampleImages: optionsState['downsample'] ?? true,
          stripMetadata: optionsState['strip-meta'] ?? true,
        },
      });
    });
  };

  return (
    <div className="card opts">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <b>{tool.name} options</b>
        {file && (
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
            Original: {formatBytes(file.size)}
          </span>
        )}
      </div>

      {/* Mode Switcher Tabs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px',
          background: 'var(--surface-2)',
          padding: '3px',
          borderRadius: 'var(--radius-sm)',
          marginBottom: '12px',
        }}
      >
        <button
          type="button"
          onClick={() => setMode('target')}
          style={{
            padding: '6px 12px',
            fontSize: '12.5px',
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: 0,
            cursor: 'pointer',
            background: mode === 'target' ? 'var(--background)' : 'transparent',
            color: mode === 'target' ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: mode === 'target' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'background-color 0.12s',
          }}
        >
          <Target size={14} />
          <span>Target file size</span>
        </button>

        <button
          type="button"
          onClick={() => setMode('preset')}
          style={{
            padding: '6px 12px',
            fontSize: '12.5px',
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: 0,
            cursor: 'pointer',
            background: mode === 'preset' ? 'var(--background)' : 'transparent',
            color: mode === 'preset' ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: mode === 'preset' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'background-color 0.12s',
          }}
        >
          <Gauge size={14} />
          <span>Quality presets</span>
        </button>
      </div>

      {/* ----------------- PRIMARY MODE: TARGET FILE SIZE ----------------- */}
      {mode === 'target' && (
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
                onChange={(e) => setTargetValue(e.target.value)}
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
                onChange={(e) => setTargetUnit(e.target.value as 'KB' | 'MB')}
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
                    onClick={() => handleApplyPreset(p)}
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
      )}

      {/* ----------------- SECONDARY MODE: MANUAL QUALITY PRESETS ----------------- */}
      {mode === 'preset' && (
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
                  onClick={() => setPreset(p)}
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
      )}

      {/* Advanced Toggles */}
      <div style={{ marginTop: '4px' }}>
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
      </div>

      {/* Output filename */}
      <div style={{ marginTop: '10px', marginBottom: '4px' }}>
        <OutputFilenameInput
          value={outputBaseName ?? ''}
          onChange={onOutputBaseNameChange ?? (() => {})}
          placeholder={defaultBaseName ?? 'compressed-document'}
          extension={outputExtension ?? '.pdf'}
        />
      </div>

      {/* Primary Action Button */}
      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={isProcessing || !file || (mode === 'target' && (!targetBytes || targetBytes <= 0))}
        style={{ marginTop: '12px', justifyContent: 'center' }}
      >
        {mode === 'target' ? <Target size={16} /> : <FileDown size={16} />}
        <span>
          {isProcessing
            ? mode === 'target'
              ? `Compressing to ${targetLabel}...`
              : 'Compressing PDF...'
            : mode === 'target'
            ? `Compress to Target Size (${targetLabel})`
            : `Compress PDF (${PRESET_CONFIG[preset].name})`}
        </span>
      </button>
    </div>
  );
}
