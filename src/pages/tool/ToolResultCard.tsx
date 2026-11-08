// Result card displayed when a PDF tool completes execution, with stats, download, and viewing options.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Check, Copy, Download, Eye, Info, RefreshCw, XCircle } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import { formatBytes } from '../../core/formatBytes';
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
  const batchStats = extraState.batchStats as
    | {
        total: number;
        successCount: number;
        failureCount: number;
        failures: { fileName: string; reason: string }[];
      }
    | undefined;

  const originalBytesCount =
    typeof extraState.successfulOriginalBytes === 'number' && extraState.successfulOriginalBytes > 0
      ? extraState.successfulOriginalBytes
      : stagedFiles.length > 1
      ? stagedFiles.reduce((acc, f) => acc + f.size, 0)
      : (stagedFiles[0]?.size ?? 0);
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

  const [isCopied, setIsCopied] = useState(false);

  const isTextOutput = outputExtension === '.txt' || tool.id === 'extract-text';
  const textPreview = useMemo(() => {
    if (!isTextOutput || !outputBytes) return '';
    try {
      return new TextDecoder().decode(outputBytes);
    } catch {
      return '';
    }
  }, [isTextOutput, outputBytes]);

  const textTrimmed = textPreview.trim();
  const wordCount = useMemo(() => {
    return textTrimmed ? textTrimmed.split(/\s+/).filter(Boolean).length : 0;
  }, [textTrimmed]);

  const handleCopyText = async () => {
    if (!textPreview || wordCount === 0) return;
    try {
      await navigator.clipboard.writeText(textPreview);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is not available
    }
  };

  let cardTitle = `${tool.name} complete!`;
  if (isTextOutput && wordCount === 0) {
    cardTitle = 'No text extracted';
  } else if (tool.id === 'compress') {
    if (batchStats && batchStats.failureCount > 0) {
      cardTitle = `Compressed ${batchStats.successCount} of ${batchStats.total} files`;
    } else if (stagedFiles.length > 1) {
      cardTitle = `Compressed ${stagedFiles.length} files!`;
    } else if (hasTarget) {
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

      {batchStats && batchStats.failureCount > 0 && (
        <div
          role="alert"
          style={{
            marginTop: '8px',
            marginBottom: '4px',
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(216, 59, 1, 0.08)',
            border: '1px solid rgba(216, 59, 1, 0.3)',
            color: 'var(--text)',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
              color: 'var(--accent, #d83b01)',
              marginBottom: '4px',
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>
              {batchStats.failureCount} of {batchStats.total} files could not be compressed
            </span>
          </div>
          <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            {batchStats.successCount} file{batchStats.successCount === 1 ? '' : 's'} successfully compressed and included in the ZIP. Failed files were excluded:
          </p>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px' }}>
            {batchStats.failures.map((f, idx) => (
              <li key={idx} style={{ marginBottom: '2px' }}>
                <strong>{f.fileName}</strong>: {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

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
          {isTextOutput && wordCount === 0
            ? '0 words extracted • 0 B'
            : `Ready to save • ${formatBytes(outputBytes.byteLength)}`}
        </div>
      )}

      {isTextOutput && (
        <div style={{ marginTop: '12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          {wordCount === 0 && (
            <div
              role="status"
              style={{
                marginBottom: '10px',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: extraState.hasImages
                  ? 'rgba(216, 59, 1, 0.08)'
                  : 'var(--surface-2)',
                border: extraState.hasImages
                  ? '1px solid rgba(216, 59, 1, 0.3)'
                  : '1px solid var(--border)',
                color: 'var(--text)',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 600,
                  color: extraState.hasImages ? 'var(--accent, #d83b01)' : 'var(--text)',
                  marginBottom: '4px',
                }}
              >
                <Info size={15} style={{ flexShrink: 0 }} />
                <span>
                  {extraState.hasImages
                    ? 'Image-based PDF (OCR required)'
                    : 'No text found in document'}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                {extraState.hasImages
                  ? 'This PDF appears to contain scanned images rather than selectable text. Optical Character Recognition (OCR) is required to extract text from image-based PDFs, which is not currently supported in InTabPDF.'
                  : 'This document does not contain any selectable text characters or font streams (e.g. blank pages or vector-only artwork).'}
              </p>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {wordCount} {wordCount === 1 ? 'word' : 'words'} • {textPreview.length} characters
            </span>
            <button
              type="button"
              className="sb sm"
              onClick={() => void handleCopyText()}
              disabled={!textPreview || wordCount === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                fontSize: '12px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {isCopied ? <Check size={13} color="var(--accent)" /> : <Copy size={13} />}
              <span>{isCopied ? 'Copied!' : 'Copy text'}</span>
            </button>
          </div>
          <textarea
            readOnly
            value={textPreview}
            placeholder="(No text found in document)"
            aria-label="Extracted text preview"
            style={{
              width: '100%',
              minHeight: '130px',
              maxHeight: '260px',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: '1.45',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
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
        className="tool-result-actions"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 120px), 1fr))',
          gap: '10px',
          marginTop: '16px',
          width: '100%',
          minWidth: 0,
        }}
      >
        <button
          type="button"
          className="cta"
          onClick={onDownload}
          disabled={isTextOutput && wordCount === 0}
          style={{
            minHeight: '44px',
            ...(isTextOutput && wordCount === 0 ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
          }}
        >
          <Download size={16} style={{ flexShrink: 0 }} />
          <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.25 }}>
            {isTextOutput && wordCount === 0
              ? 'No text to save'
              : isSaved
              ? 'Download again'
              : isZipOutput
              ? 'Save ZIP'
              : isTextOutput
              ? 'Save TXT'
              : 'Save PDF'}
          </span>
        </button>

        {!isZipOutput && !isTextOutput && (
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
