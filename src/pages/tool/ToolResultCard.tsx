// Result card displayed when a PDF tool completes execution, with stats, download, and viewing options.
import type { ReactNode } from 'react';
import { Download, Eye } from 'lucide-react';
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
}: ToolResultCardProps): ReactNode {
  const originalBytesCount = stagedFiles[0]?.size ?? 0;
  const newBytesCount = outputBytes.byteLength;
  const savedBytesCount = originalBytesCount - newBytesCount;
  const isReduced = savedBytesCount > 0;
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

  let cardTitle = `${tool.name} complete!`;
  if (tool.id === 'compress' && hasTarget) {
    cardTitle = targetAchieved ? 'Target size achieved!' : 'Smallest result obtained';
  }

  return (
    <div className="card done" role="region" aria-label="Processing results">
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
                    ? 'rgba(16, 124, 65, 0.15)'
                    : 'rgba(216, 59, 1, 0.12)',
                  color: targetAchieved ? '#107c41' : '#d83b01',
                  fontWeight: 600,
                  fontSize: '12px',
                  border: targetAchieved
                    ? '1px solid rgba(16, 124, 65, 0.3)'
                    : '1px solid rgba(216, 59, 1, 0.3)',
                }}
              >
                {targetAchieved ? '✓ Target achieved' : 'Target not reached'}
              </span>
            )}

            {isReduced ? (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'rgba(16, 124, 65, 0.15)',
                  color: '#107c41',
                  fontWeight: 600,
                  fontSize: '12px',
                }}
              >
                Saved {formatBytes(savedBytesCount)} ({savedPercentStr}%)
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
          </div>

          {/* File Size Breakdown */}
          <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
            {hasTarget && (
              <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)' }}>
                <span>Target requested:</span>
                <strong style={{ color: 'var(--text)' }}>{targetLabel}</strong>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Actual output:</span>
              <strong style={{ color: 'var(--text)' }}>{formatBytes(newBytesCount)}</strong>
              <span style={{ color: 'var(--text-muted)' }}>
                (from {formatBytes(originalBytesCount)})
              </span>
            </div>
          </div>

          {/* Honest Explanatory Guidance */}
          <small style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {hasTarget
              ? targetAchieved
                ? 'The PDF was successfully compressed to fit within your specified target limit.'
                : 'The requested target could not be reached without unacceptable image degradation, or the document contains already-compressed content. The smallest safe result is provided.'
              : isReduced
              ? 'Ready to save.'
              : 'This document could not be compressed further without quality degradation.'}
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '10px',
          marginTop: '16px',
        }}
      >
        <button type="button" className="cta" onClick={onDownload}>
          <Download size={16} />
          <span>{isSaved ? 'Download again' : isZipOutput ? 'Save ZIP' : 'Save PDF'}</span>
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
            }}
          >
            <Eye size={16} />
            <span>{platformType === 'web' ? 'View on Web' : 'Open in Viewer'}</span>
          </button>
        )}
        <button
          type="button"
          className="cta"
          onClick={onStartOver}
          style={{ background: 'transparent', color: 'var(--text-muted)' }}
        >
          Start over
        </button>
      </div>
    </div>
  );
}
