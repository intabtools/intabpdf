// Result card displayed when a PDF tool completes execution, with stats, download, and viewing options.
import type { ReactNode } from 'react';
import { Download, Eye, RefreshCw, XCircle } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import { formatBytes } from '../../core';
import type { PlatformType } from '../../platform';
import type { StagedFile, ToolDefinition } from '../../tools/types';

interface ToolResultCardProps {
  tool: ToolDefinition;
  stagedFiles: StagedFile[];
  outputBytes: Uint8Array;
  extraState: Record<string, unknown>;
  customFileName: string;
  onCustomFileNameChange: (name: string) => void;
  defaultBaseName: string;
  outputExtension: string;
  isSaved: boolean;
  isZipOutput: boolean;
  platformType: PlatformType;
  onDownload: () => void;
  onViewPdf: () => void;
  onStartOver: () => void;
  onClearFiles?: () => void;
}

export default function ToolResultCard({
  tool,
  stagedFiles,
  outputBytes,
  extraState,
  customFileName,
  onCustomFileNameChange,
  defaultBaseName,
  outputExtension,
  isSaved,
  isZipOutput,
  platformType,
  onDownload,
  onViewPdf,
  onStartOver,
  onClearFiles,
}: ToolResultCardProps): ReactNode {
  const originalBytesCount = stagedFiles[0]?.size ?? 0;
  const newBytesCount = outputBytes.byteLength;
  const savedBytesCount = originalBytesCount - newBytesCount;
  const isReduced = savedBytesCount > 0;
  const isLarger = newBytesCount > originalBytesCount;
  const savedPercentStr =
    originalBytesCount > 0 && isReduced
      ? ((savedBytesCount / originalBytesCount) * 100).toFixed(1)
      : '0';

  const targetBytes =
    typeof extraState.targetBytes === 'number' && extraState.targetBytes > 0
      ? extraState.targetBytes
      : undefined;
  const targetLabel =
    typeof extraState.targetLabel === 'string'
      ? extraState.targetLabel
      : targetBytes
      ? formatBytes(targetBytes)
      : undefined;
  const hasTarget = targetBytes !== undefined;
  const targetAchieved = hasTarget ? newBytesCount <= targetBytes : undefined;
  const presetName =
    typeof extraState.presetName === 'string' ? extraState.presetName : undefined;

  let cardTitle = `${tool.name} complete!`;
  if (tool.id === 'compress') {
    if (hasTarget) {
      cardTitle = targetAchieved ? 'Target size achieved!' : 'Target not reached';
    } else {
      cardTitle = isReduced ? 'Compression complete!' : 'Document already optimized';
    }
  }

  return (
    <div
      className="card done"
      role="region"
      aria-label="Processing results"
      aria-live="polite"
    >
      <b>{cardTitle}</b>

      {tool.id === 'compress' ? (
        <div
          className="meta"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}
        >
          {/* Status Badges Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {hasTarget && (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-pill)',
                  background: targetAchieved
                    ? 'var(--success-soft)'
                    : 'rgba(216, 59, 1, 0.12)',
                  color: targetAchieved ? 'var(--success)' : 'var(--accent, #d83b01)',
                  fontWeight: 600,
                  fontSize: '12px',
                  border: targetAchieved
                    ? '1px solid var(--success)'
                    : '1px solid rgba(216, 59, 1, 0.3)',
                }}
              >
                {targetAchieved
                  ? `✓ Target met (${formatBytes(newBytesCount)} ≤ ${targetLabel})`
                  : `Target not reached (${formatBytes(newBytesCount)} > ${targetLabel})`}
              </span>
            )}

            {isReduced ? (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--success-soft)',
                  color: 'var(--success)',
                  fontWeight: 600,
                  fontSize: '12px',
                }}
              >
                Saved {formatBytes(savedBytesCount)} ({savedPercentStr}%)
              </span>
            ) : isLarger ? (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'rgba(216, 59, 1, 0.12)',
                  color: 'var(--accent, #d83b01)',
                  fontWeight: 600,
                  fontSize: '12px',
                  border: '1px solid rgba(216, 59, 1, 0.3)',
                }}
              >
                Larger by +{formatBytes(newBytesCount - originalBytesCount)}
              </span>
            ) : (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  fontSize: '12px',
                  border: '1px solid var(--border)',
                }}
              >
                Already optimized
              </span>
            )}

            {presetName && (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-muted)',
                  fontWeight: 500,
                  fontSize: '12px',
                  border: '1px solid var(--border)',
                }}
              >
                Mode: {presetName}
              </span>
            )}
          </div>

          {/* File Size Breakdown */}
          <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
            {hasTarget && (
              <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)' }}>
                <span>Target requested:</span>
                <strong style={{ color: 'var(--text)' }}>{targetLabel}</strong>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)' }}>Actual output:</span>
              <strong style={{ color: 'var(--text)' }}>{formatBytes(newBytesCount)}</strong>
              <span style={{ color: 'var(--text-muted)' }}>
                (Original source: {formatBytes(originalBytesCount)})
              </span>
            </div>
          </div>

          {/* Honest Explanatory Guidance */}
          <small style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {hasTarget
              ? targetAchieved
                ? `The PDF was successfully compressed to fit within your specified target limit of ${targetLabel}.`
                : `The requested target of ${targetLabel} could not be reached without unacceptable quality loss or because the document contains already-compressed content. The smallest safe result (${formatBytes(newBytesCount)}) is provided.`
              : isLarger
              ? `The re-encoded streams or object tables slightly increased the file size (+${formatBytes(newBytesCount - originalBytesCount)}). Retaining your original file is recommended.`
              : isReduced
              ? `Your document was compressed using the ${presetName || 'selected'} strategy while strictly preserving text, fonts, links, and page layouts.`
              : 'This document could not be compressed further without quality degradation. Text, vector drawings, and already-compressed images were preserved.'}
          </small>
        </div>
      ) : (
        <div className="meta">
          Ready to save • {formatBytes(outputBytes.byteLength)}
        </div>
      )}

      {/* Output filename input before saving */}
      <div style={{ marginTop: '14px', marginBottom: '8px' }}>
        <OutputFilenameInput
          id="output-filename-done"
          value={customFileName}
          onChange={onCustomFileNameChange}
          placeholder={defaultBaseName}
          extension={outputExtension}
          label="Save as"
        />
      </div>

      {/* Action Buttons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 120px), 1fr))',
          gap: '10px',
          marginTop: '16px',
          width: '100%',
          minWidth: 0,
        }}
      >
        <button type="button" className="cta" onClick={onDownload} style={{ minHeight: '44px' }}>
          <Download size={16} style={{ flexShrink: 0 }} />
          <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.25 }}>
            {isSaved ? 'Download again' : isZipOutput ? 'Save ZIP' : 'Save PDF'}
          </span>
        </button>

        {!isZipOutput && (
          <button
            type="button"
            className="cta"
            onClick={onViewPdf}
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              minHeight: '44px',
            }}
          >
            <Eye size={16} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.25 }}>
              {platformType === 'web' ? 'View on Web' : 'Open in Viewer'}
            </span>
          </button>
        )}

        <button
          type="button"
          className="cta"
          onClick={onStartOver}
          style={{
            background: 'var(--surface-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            minHeight: '44px',
          }}
        >
          <RefreshCw size={15} style={{ flexShrink: 0 }} />
          <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.25 }}>Change settings</span>
        </button>

        <button
          type="button"
          className="cta"
          onClick={onClearFiles || onStartOver}
          style={{
            background: 'transparent',
            color: 'var(--text-muted)',
            minHeight: '44px',
          }}
        >
          <XCircle size={15} style={{ flexShrink: 0 }} />
          <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.25 }}>Choose another PDF</span>
        </button>
      </div>
    </div>
  );
}
