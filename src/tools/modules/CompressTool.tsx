// Tool module for compressing PDF documents to target file sizes or quality presets.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FileDown, Gauge, Target } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { pdfProcessingService } from '../../core';
import type { CompressionPreset } from '../../core';
import { formatBytes } from '../../core/formatBytes';
import { PRESET_CONFIG, type TargetPreset } from './compress/compressConfig';
import TargetSizeSection from './compress/TargetSizeSection';
import QualityPresetSection from './compress/QualityPresetSection';

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

      {/* Primary mode: Target file size */}
      {mode === 'target' && (
        <TargetSizeSection
          file={file}
          targetValue={targetValue}
          onTargetValueChange={setTargetValue}
          targetUnit={targetUnit}
          onTargetUnitChange={setTargetUnit}
          targetBytes={targetBytes}
          targetLabel={targetLabel}
          onApplyPreset={handleApplyPreset}
        />
      )}

      {/* Secondary mode: Manual quality presets */}
      {mode === 'preset' && (
        <QualityPresetSection
          preset={preset}
          onPresetChange={setPreset}
        />
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
