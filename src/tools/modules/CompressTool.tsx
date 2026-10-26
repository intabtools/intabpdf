// Tool module for compressing PDF documents to target file sizes or quality presets.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FileDown, Gauge, Info, Sparkles, Target, Zap } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { analyzePdfDocument, pdfProcessingService } from '../../core';
import type { CompressionPreset } from '../../core';
import { formatBytes } from '../../core/formatBytes';
import {
  PRESET_CARDS,
  type CompressionMode,
  type TargetPreset,
} from './compress/compressConfig';
import TargetSizeSection from './compress/TargetSizeSection';

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

  // Primary mode: 'recommended' | 'smaller' | 'high-quality' | 'target'
  const [mode, setMode] = useState<CompressionMode>('recommended');
  const [hasSignatures, setHasSignatures] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (file?.bytes) {
      analyzePdfDocument(file.bytes)
        .then((analysis) => {
          if (!cancelled) setHasSignatures(analysis.hasSignatures);
        })
        .catch(() => {
          if (!cancelled) setHasSignatures(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [file]);

  const showSignatureWarning = Boolean(file) && hasSignatures;

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

  // Compute numeric target bytes from current inputs
  const numericVal = parseFloat(targetValue);
  const targetBytes =
    !isNaN(numericVal) && numericVal > 0
      ? Math.round(targetUnit === 'MB' ? numericVal * 1024 * 1024 : numericVal * 1024)
      : null;

  const targetLabel = targetBytes ? `${targetValue} ${targetUnit}` : null;

  // Selected preset card configuration
  const activePresetCard =
    PRESET_CARDS.find((c) => c.id === mode) || PRESET_CARDS[0];

  // Inform parent ToolPage of active target/preset so results card can format accurate metrics
  useEffect(() => {
    if (mode === 'target') {
      onExtraStateChange?.('targetBytes', targetBytes);
      onExtraStateChange?.('targetLabel', targetLabel);
      onExtraStateChange?.('presetName', 'Target size');
      onExtraStateChange?.('strategySummary', 'Custom target file size search');
    } else {
      onExtraStateChange?.('targetBytes', undefined);
      onExtraStateChange?.('targetLabel', undefined);
      onExtraStateChange?.('presetName', activePresetCard.name);
      onExtraStateChange?.('strategySummary', activePresetCard.strategySummary);
    }
  }, [mode, targetBytes, targetLabel, activePresetCard, onExtraStateChange]);

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
    onExtraStateChange?.(
      'presetName',
      mode === 'target' ? 'Target size' : activePresetCard.name
    );
    onExtraStateChange?.(
      'strategySummary',
      mode === 'target'
        ? 'Custom target file size search'
        : activePresetCard.strategySummary
    );

    await onExecute(async () => {
      const corePreset: CompressionPreset | undefined =
        mode === 'target'
          ? undefined
          : (activePresetCard.corePreset as CompressionPreset);

      return await pdfProcessingService.execute('compress', {
        buffer: file.bytes,
        options: {
          targetBytes: mode === 'target' ? (targetBytes ?? undefined) : undefined,
          preset: corePreset,
          downsampleImages: optionsState['downsample'] ?? true,
          stripMetadata: optionsState['strip-meta'] ?? true,
        },
      });
    });
  };

  // Determine active strategy action label
  const actionLabel = isProcessing
    ? mode === 'target'
      ? `Compressing to ${targetLabel}...`
      : `Compressing PDF (${activePresetCard.name})...`
    : mode === 'target'
    ? `Compress to Target Size (${targetLabel || 'Custom'})`
    : `Compress PDF (${activePresetCard.name})`;

  return (
    <div className="card opts">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
        }}
      >
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

      {showSignatureWarning && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(216, 59, 1, 0.08)',
            border: '1px solid rgba(216, 59, 1, 0.3)',
            color: 'var(--accent, #d83b01)',
            fontSize: '12px',
            marginBottom: '10px',
            minWidth: 0,
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          <Info size={16} style={{ flexShrink: 0 }} />
          <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
            <strong>Notice:</strong> This document contains digital signatures. Compressing or modifying it will invalidate cryptographic signature seals.
          </span>
        </div>
      )}

      {/* Preset & Mode Selection */}
      <div
        role="tablist"
        aria-label="Compression preset modes"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 105px), 1fr))',
          gap: '6px',
          background: 'var(--surface-2)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          marginBottom: '14px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'recommended'}
          onClick={() => setMode('recommended')}
          style={{
            padding: '8px 6px',
            fontSize: '12px',
            fontWeight: mode === 'recommended' ? 600 : 500,
            borderRadius: 'var(--radius-sm)',
            border: 0,
            cursor: 'pointer',
            background: mode === 'recommended' ? 'var(--background)' : 'transparent',
            color: mode === 'recommended' ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: mode === 'recommended' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            minHeight: '44px',
            minWidth: 0,
            boxSizing: 'border-box',
            transition: 'all 0.12s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, maxWidth: '100%' }}>
            <Gauge size={13} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Recommended</span>
          </div>
          <span
            style={{
              fontSize: '10px',
              opacity: mode === 'recommended' ? 0.9 : 0.7,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}
          >
            Balanced
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mode === 'smaller'}
          onClick={() => setMode('smaller')}
          style={{
            padding: '8px 6px',
            fontSize: '12px',
            fontWeight: mode === 'smaller' ? 600 : 500,
            borderRadius: 'var(--radius-sm)',
            border: 0,
            cursor: 'pointer',
            background: mode === 'smaller' ? 'var(--background)' : 'transparent',
            color: mode === 'smaller' ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: mode === 'smaller' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            minHeight: '44px',
            minWidth: 0,
            boxSizing: 'border-box',
            transition: 'all 0.12s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, maxWidth: '100%' }}>
            <Zap size={13} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Smaller file</span>
          </div>
          <span
            style={{
              fontSize: '10px',
              opacity: mode === 'smaller' ? 0.9 : 0.7,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}
          >
            Smallest
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mode === 'high-quality'}
          onClick={() => setMode('high-quality')}
          style={{
            padding: '8px 6px',
            fontSize: '12px',
            fontWeight: mode === 'high-quality' ? 600 : 500,
            borderRadius: 'var(--radius-sm)',
            border: 0,
            cursor: 'pointer',
            background: mode === 'high-quality' ? 'var(--background)' : 'transparent',
            color: mode === 'high-quality' ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: mode === 'high-quality' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            minHeight: '44px',
            minWidth: 0,
            boxSizing: 'border-box',
            transition: 'all 0.12s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, maxWidth: '100%' }}>
            <Sparkles size={13} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>High quality</span>
          </div>
          <span
            style={{
              fontSize: '10px',
              opacity: mode === 'high-quality' ? 0.9 : 0.7,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}
          >
            Fidelity
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mode === 'target'}
          onClick={() => setMode('target')}
          style={{
            padding: '8px 6px',
            fontSize: '12px',
            fontWeight: mode === 'target' ? 600 : 500,
            borderRadius: 'var(--radius-sm)',
            border: 0,
            cursor: 'pointer',
            background: mode === 'target' ? 'var(--background)' : 'transparent',
            color: mode === 'target' ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: mode === 'target' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            minHeight: '44px',
            minWidth: 0,
            boxSizing: 'border-box',
            transition: 'all 0.12s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, maxWidth: '100%' }}>
            <Target size={13} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Target size</span>
          </div>
          <span
            style={{
              fontSize: '10px',
              opacity: mode === 'target' ? 0.9 : 0.7,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}
          >
            Custom
          </span>
        </button>
      </div>

      {/* Target Size Configuration Mode */}
      {mode === 'target' ? (
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
      ) : (
        /* Quality Preset Details & Trade-offs */
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
            marginBottom: '4px',
            minWidth: 0,
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          <Info size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
            <div style={{ minWidth: 0, wordBreak: 'break-word' }}>
              <b style={{ color: 'var(--text)', display: 'inline', marginRight: '6px' }}>
                {activePresetCard.name}:
              </b>
              <span>{activePresetCard.details}</span>
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
                {activePresetCard.strategySummary}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Toggles */}
      <div style={{ marginTop: '10px', width: '100%', minWidth: 0 }}>
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
      <div style={{ marginTop: '10px', marginBottom: '4px', width: '100%', minWidth: 0, maxWidth: '100%' }}>
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
        disabled={
          isProcessing || !file || (mode === 'target' && (!targetBytes || targetBytes <= 0))
        }
        style={{
          marginTop: '12px',
          justifyContent: 'center',
          minHeight: '44px',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        {mode === 'target' ? <Target size={16} style={{ flexShrink: 0 }} /> : <FileDown size={16} style={{ flexShrink: 0 }} />}
        <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.3 }}>{actionLabel}</span>
      </button>
    </div>
  );
}
