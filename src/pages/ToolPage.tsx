import { Suspense, createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Download, Eye, FileText, GripVertical, RotateCcw, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DropZone from '../components/DropZone';
import ImagePreviewModal from '../components/ImagePreviewModal';
import OutputFilenameInput from '../components/OutputFilenameInput';
import ToolIcon from '../components/ToolIcon';
import { useShell } from '../hooks/useShell';
import { useToast } from '../hooks/useToast';
import { useViewer } from '../hooks/useViewer';
import { platform } from '../platform';
import type { OpenedFile } from '../platform';
import {
  getDefaultOutputBaseName,
  getOutputExtension,
  sanitizeOutputFileName,
} from '../tools/filename';
import { calculateDropIndex, reorderItems } from '../tools/reorder';
import { TOOLS, getToolById, getToolComponent, isToolImplemented } from '../tools/registry';
import type { StagedFile } from '../tools/types';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  return Math.round(bytes / 1024) + ' KB';
}

function ThumbnailPreview({ file }: { file: StagedFile }): ReactNode {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isImage = Boolean(file.name.match(/\.(jpe?g|png|webp|gif|bmp)$/i) && file.bytes);

  useEffect(() => {
    if (!isImage || !file.bytes || !imgRef.current) return;
    const blob = new Blob([file.bytes as BlobPart]);
    const url = URL.createObjectURL(blob);
    imgRef.current.src = url;

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file.bytes, isImage]);

  if (!isImage) {
    return <FileText size={16} />;
  }

  return (
    <img
      ref={imgRef}
      alt={file.name}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '2px' }}
    />
  );
}

export default function ToolPage(): ReactNode {
  const { toolId } = useParams<{ toolId: string }>();
  const navigate = useNavigate();
  const { loadFile } = useViewer();
  const { shell } = useShell();
  const { showToast } = useToast();

  const tool = getToolById(toolId || '');
  const isImplemented = tool ? isToolImplemented(tool.id) : false;

  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [optionsState, setOptionsState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    tool?.options.forEach((opt) => {
      initial[opt.id] = opt.defaultValue;
    });
    return initial;
  });
  const [status, setStatus] = useState<'idle' | 'busy' | 'done'>('idle');
  const [outputBytes, setOutputBytes] = useState<Uint8Array | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [extraState, setExtraState] = useState<Record<string, unknown>>({});
  const [customFileName, setCustomFileName] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  const touchDragRef = useRef<{ startIndex: number } | null>(null);

  const defaultBaseName = useMemo(
    () => (tool ? getDefaultOutputBaseName(tool.id, stagedFiles) : 'document'),
    [tool, stagedFiles]
  );

  const outputExtension = useMemo(
    () => (tool ? getOutputExtension(tool.id, tool.outputName) : '.pdf'),
    [tool]
  );

  const isZipOutput = outputExtension === '.zip';

  const resolvedBaseName = customFileName.trim() ? customFileName : defaultBaseName;
  const finalFileName = sanitizeOutputFileName(resolvedBaseName, defaultBaseName, outputExtension);

  const handleExtraStateChange = (key: string, value: unknown) => {
    setExtraState((prev) => ({ ...prev, [key]: value }));
  };

  // Lazily load the tool implementation module on demand
  const ToolComponent = tool ? getToolComponent(tool) : null;

  useEffect(() => {
    if (tool && !isImplemented) {
      showToast('Coming soon');
    }
  }, [tool, isImplemented, showToast]);

  if (!tool) {
    return (
      <div className="cnt">
        <div className="card busy">
          <b>Tool not found</b>
          <p className="lede">The requested tool does not exist.</p>
          <button type="button" className="cta" onClick={() => navigate('/')}>
            Back to All Tools
          </button>
        </div>
      </div>
    );
  }

  if (!isImplemented) {
    return (
      <div className="cnt">
        <div className="card busy" style={{ textAlign: 'center', padding: '36px 20px' }}>
          <ToolIcon name={tool.icon} size={36} />
          <b style={{ fontSize: '18px', marginTop: '12px' }}>{tool.name}</b>
          <p className="lede" style={{ margin: '8px 0 20px' }}>
            This tool is coming soon.
          </p>
          <button type="button" className="cta" onClick={() => navigate('/')}>
            Back to All Tools
          </button>
        </div>
      </div>
    );
  }

  const handleFilesAdded = (files: OpenedFile[]) => {
    const newItems: StagedFile[] = files.map((f, i) => ({
      id: `${f.name}-${Date.now()}-${i}`,
      name: f.name,
      size: f.bytes.byteLength,
      bytes: f.bytes,
    }));
    setStagedFiles((prev) => [...prev, ...newItems]);
    setStatus('idle');
    setOutputBytes(null);
    setErrorMessage(null);
    setIsSaved(false);
    setExtraState({});
    setCustomFileName('');
    setPreviewIndex(null);
  };

  const handleRemoveFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
    setPreviewIndex(null);
  };

  const handleMoveFile = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    setStagedFiles((prev) => reorderItems(prev, index, targetIndex));
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';
    setDragOver({ index, position });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setDragOver(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null) return;
    const position = dragOver?.position ?? 'after';
    const destinationIndex = calculateDropIndex(draggedIndex, targetIndex, position);
    if (destinationIndex !== draggedIndex) {
      setStagedFiles((prev) => reorderItems(prev, draggedIndex, destinationIndex));
    }
    setDraggedIndex(null);
    setDragOver(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOver(null);
  };

  const handleTouchStartGrip = (_e: React.TouchEvent, index: number) => {
    touchDragRef.current = { startIndex: index };
    setDraggedIndex(index);
  };

  const handleTouchMoveGrip = (e: React.TouchEvent) => {
    if (!touchDragRef.current) return;
    const touch = e.touches[0];
    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = elem?.closest('[data-staged-index]');
    if (card) {
      const targetIdx = parseInt(card.getAttribute('data-staged-index')!, 10);
      if (!isNaN(targetIdx)) {
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const position = touch.clientY < midY ? 'before' : 'after';
        setDragOver({ index: targetIdx, position });
      }
    }
  };

  const handleTouchEndGrip = () => {
    if (touchDragRef.current && dragOver) {
      const fromIdx = touchDragRef.current.startIndex;
      const destIdx = calculateDropIndex(fromIdx, dragOver.index, dragOver.position);
      if (destIdx !== fromIdx) {
        setStagedFiles((prev) => reorderItems(prev, fromIdx, destIdx));
      }
    }
    touchDragRef.current = null;
    setDraggedIndex(null);
    setDragOver(null);
  };

  const handleGripKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowUp' || (e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      if (index > 0) {
        handleMoveFile(index, 'up');
      }
    } else if (e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      if (index < stagedFiles.length - 1) {
        handleMoveFile(index, 'down');
      }
    }
  };

  const handleExecuteRunner = async (runner: () => Promise<Uint8Array>) => {
    setStatus('busy');
    setOutputBytes(null);
    setErrorMessage(null);
    setIsSaved(false);

    try {
      const result = await runner();
      setOutputBytes(result);
      setStatus('done');
    } catch (err) {
      console.error('PDF tool processing failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Processing failed');
      setStatus('idle');
    }
  };

  const handleDownload = async () => {
    if (!outputBytes) return;
    try {
      await platform.saveFile?.(
        outputBytes,
        finalFileName,
        isZipOutput ? 'application/zip' : 'application/pdf'
      );
      setIsSaved(true);
      showToast(`Saved ${finalFileName}`);
    } catch (err) {
      console.error('Failed to save file:', err);
      showToast('Failed to save file');
    }
  };

  const handleOpenInViewer = () => {
    if (!outputBytes) return;
    loadFile({
      name: finalFileName,
      bytes: outputBytes,
    });
    navigate('/viewer');
  };

  const otherTools = TOOLS.filter((t) => t.id !== tool.id).slice(0, 8);

  const mainToolContent = (
    <>
      <ImagePreviewModal
        files={stagedFiles}
        currentIndex={previewIndex ?? 0}
        isOpen={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        onNavigate={(idx) => setPreviewIndex(idx)}
      />

      {status === 'busy' && (
        <div className="card busy" role="status" aria-live="polite">
          <div className="spin" />
          <b style={{ marginTop: '14px', fontSize: '16px' }}>Processing document...</b>
          <p className="lede" style={{ margin: '4px 0 0' }}>
            All operations run privately on your local device.
          </p>
        </div>
      )}

      {errorMessage && (
        <div
          className="card busy"
          style={{
            borderColor: '#E81123',
            background: 'rgba(232, 17, 35, 0.08)',
            marginBottom: '16px',
          }}
          role="alert"
        >
          <AlertCircle size={28} color="#E81123" />
          <b style={{ marginTop: '8px', color: '#E81123' }}>Operation failed</b>
          <p className="lede" style={{ margin: '4px 0 14px' }}>
            {errorMessage}
          </p>
          <button
            type="button"
            className="cta"
            onClick={() => setStatus('idle')}
            style={{ background: 'var(--text)' }}
          >
            <RotateCcw size={16} />
            <span>Try again</span>
          </button>
        </div>
      )}

      {status === 'done' && outputBytes && (() => {
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
              <div className="meta" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                {/* Status Badges Row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {hasTarget && (
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-pill)',
                        background: targetAchieved ? 'rgba(16, 124, 65, 0.15)' : 'rgba(216, 59, 1, 0.12)',
                        color: targetAchieved ? '#107c41' : '#d83b01',
                        fontWeight: 600,
                        fontSize: '12px',
                        border: targetAchieved ? '1px solid rgba(16, 124, 65, 0.3)' : '1px solid rgba(216, 59, 1, 0.3)',
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
                onChange={setCustomFileName}
                placeholder={defaultBaseName}
                extension={outputExtension}
                label="Save as"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                className="cta"
                onClick={handleDownload}
              >
                <Download size={16} />
                <span>{isSaved ? 'Download again' : isZipOutput ? 'Save ZIP' : 'Save PDF'}</span>
              </button>
              {!isZipOutput && (
                <button
                  type="button"
                  className="cta"
                  onClick={handleOpenInViewer}
                  style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}
                >
                  <Eye size={16} />
                  <span>Open in Viewer</span>
                </button>
              )}
              <button
                type="button"
                className="cta"
                onClick={() => {
                  setStatus('idle');
                  setOutputBytes(null);
                }}
                style={{ background: 'transparent', color: 'var(--text-muted)' }}
              >
                Start over
              </button>
            </div>
          </div>
        );
      })()}

      {status === 'idle' && stagedFiles.length === 0 && (
        <DropZone
          title={tool.name}
          subtitle={tool.description}
          multiple={tool.id === 'merge' || tool.id === 'images-to-pdf'}
          accept={
            tool.fileType === 'img'
              ? 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
              : tool.fileType === 'txt'
              ? '.txt,text/plain'
              : 'application/pdf,.pdf'
          }
          onFilesSelected={handleFilesAdded}
        />
      )}

      {status !== 'done' && stagedFiles.length > 0 && (
        <div className="tp">
          <div>
            {stagedFiles.map((file, index) => {
              const isFileImage = Boolean(file.name.match(/\.(jpe?g|png|webp|gif|bmp)$/i) && file.bytes);
              const isDragOver = dragOver?.index === index;
              const dragOverClass = isDragOver
                ? dragOver.position === 'before'
                  ? 'drag-over-before'
                  : 'drag-over-after'
                : '';

              return (
                <div
                  key={file.id}
                  data-staged-index={index}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`card fi ${draggedIndex === index ? 'dragging' : ''} ${dragOverClass}`}
                >
                  <span
                    className="gr"
                    tabIndex={0}
                    role="button"
                    aria-label={`Reorder ${file.name}. Press Alt+Up or Alt+Down to move.`}
                    title="Drag to reorder (Alt+Up / Alt+Down)"
                    onTouchStart={(e) => handleTouchStartGrip(e, index)}
                    onTouchMove={handleTouchMoveGrip}
                    onTouchEnd={handleTouchEndGrip}
                    onTouchCancel={handleTouchEndGrip}
                    onKeyDown={(e) => handleGripKeyDown(e, index)}
                  >
                    <GripVertical size={16} />
                  </span>

                  <span className="pgw">
                    <button
                      type="button"
                      className="pg-thumb-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isFileImage) {
                          setPreviewIndex(index);
                        }
                      }}
                      disabled={!isFileImage}
                      aria-label={isFileImage ? `Preview ${file.name}` : undefined}
                      title={isFileImage ? `Click to preview ${file.name}` : undefined}
                      draggable={false}
                    >
                      <div className="pg">
                        <div className="pgi" style={{ overflow: 'hidden' }}>
                          <ThumbnailPreview file={file} />
                        </div>
                      </div>
                    </button>
                  </span>

                  <span className="nm">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      {tool.id === 'images-to-pdf' && (
                        <span
                          className="badge-page"
                          title={`Page ${index + 1} of ${stagedFiles.length} in output PDF`}
                        >
                          Page {index + 1}
                        </span>
                      )}
                      <b title={file.name}>{file.name}</b>
                    </div>
                    <small>{formatBytes(file.size)}</small>
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {stagedFiles.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="ib sm"
                          onClick={() => handleMoveFile(index, 'up')}
                          disabled={index === 0}
                          aria-label={`Move ${file.name} up`}
                          title="Move up"
                          draggable={false}
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          type="button"
                          className="ib sm"
                          onClick={() => handleMoveFile(index, 'down')}
                          disabled={index === stagedFiles.length - 1}
                          aria-label={`Move ${file.name} down`}
                          title="Move down"
                          draggable={false}
                        >
                          <ChevronDown size={16} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="ib sm"
                      onClick={() => handleRemoveFile(file.id)}
                      aria-label={`Remove ${file.name}`}
                      title="Remove"
                      draggable={false}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}

            <DropZone
              title="Add more files"
              subtitle="Choose additional files"
              ctaText="Add"
              multiple={true}
              accept={
                tool.fileType === 'img'
                  ? 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
                  : tool.fileType === 'txt'
                  ? '.txt,text/plain'
                  : 'application/pdf,.pdf'
              }
              onFilesSelected={handleFilesAdded}
              className="add"
            />
          </div>

          <Suspense fallback={<div className="card opts"><div className="spin" /></div>}>
            {ToolComponent &&
              createElement(ToolComponent, {
                tool,
                stagedFiles,
                onFilesChange: setStagedFiles,
                optionsState,
                onOptionsChange: setOptionsState,
                onExecute: handleExecuteRunner,
                isProcessing: status === 'busy',
                extraState,
                onExtraStateChange: handleExtraStateChange,
                outputBaseName: customFileName,
                onOutputBaseNameChange: setCustomFileName,
                defaultBaseName,
                outputExtension,
              })}
          </Suspense>
        </div>
      )}
    </>
  );

  if (shell === 'web') {
    return (
      <div className="wp">
        <nav className="bc" aria-label="Breadcrumb">
          <Link to="/">All tools</Link>
          <span aria-hidden="true">/</span>
          <b>{tool.name}</b>
        </nav>
        <h1 className="wh1">{tool.name}</h1>
        {mainToolContent}
        <h2 className="wgl" style={{ marginTop: '44px' }}>More tools</h2>
        <div className="chips">
          {otherTools.map((t) => (
            <Link
              key={t.id}
              to={`/tool/${t.id}`}
              onClick={(e) => {
                if (!isToolImplemented(t.id)) {
                  e.preventDefault();
                  showToast('Coming soon');
                }
              }}
              className="chip"
            >
              <ToolIcon name={t.icon} size={16} />
              <span>{t.name}</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return <div className="cnt">{mainToolContent}</div>;
}
