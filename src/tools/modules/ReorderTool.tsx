// Tool module for reordering pages within a single PDF document.
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Grid, RefreshCw } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { getPdfPageCount } from '../../core/split';
import { pdfProcessingService } from '../../core/worker/service';
import { reorderItems } from '../reorder';

export default function ReorderTool({
  tool,
  stagedFiles,
  optionsState,
  onOptionsChange,
  onExecute,
  isProcessing,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const file = stagedFiles[0];
  const [prevFileId, setPrevFileId] = useState<string | undefined>(file?.id);

  if (file?.id !== prevFileId) {
    setPrevFileId(file?.id);
    if (!file?.bytes) {
      setPageCount(null);
      setPageOrder([]);
    }
  }

  // Inspect page count whenever the staged file changes
  useEffect(() => {
    let active = true;

    if (file?.bytes) {
      void getPdfPageCount(file.bytes).then(
        (count) => {
          if (!active) return;
          setPageCount(count);
          setPageOrder(Array.from({ length: count }, (_, i) => i));
          setPageError(null);
        },
        (err: unknown) => {
          if (!active) return;
          setPageError(err instanceof Error ? err.message : 'Failed to inspect PDF');
          setPageCount(null);
          setPageOrder([]);
        }
      );
    }

    return () => {
      active = false;
    };
  }, [file]);

  const showThumbnails = optionsState['thumbs'] ?? true;

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const handleMove = (from: number, to: number) => {
    if (from < 0 || to < 0 || from >= pageOrder.length || to >= pageOrder.length) return;
    setPageOrder((prev) => reorderItems(prev, from, to));
  };

  const handleReverse = () => {
    setPageOrder((prev) => [...prev].reverse());
  };

  const handleReset = () => {
    if (pageCount) {
      setPageOrder(Array.from({ length: pageCount }, (_, i) => i));
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    if (draggedIndex !== null && draggedIndex !== index) {
      setPageOrder((prev) => reorderItems(prev, draggedIndex, index));
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const isOrderChanged = useMemo(() => {
    return pageOrder.some((origIndex, currentPos) => origIndex !== currentPos);
  }, [pageOrder]);

  const handleRun = async () => {
    if (!file?.bytes || pageOrder.length === 0 || isProcessing) return;

    await onExecute(async (signal) => {
      return await pdfProcessingService.execute(
        'reorder',
        {
          buffer: file.bytes,
          pageOrder,
        },
        { signal }
      );
    });
  };

  return (
    <>
      {/* Left Column: Visual Reorder Workspace */}
      <div
        className="card"
        style={{
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Grid size={18} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
              Page Order {pageCount !== null ? `(${pageCount} pages)` : ''}
            </h3>
          </div>

          {pageCount !== null && pageCount > 1 && (
            <div className="reorder-header-actions" style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary sm"
                onClick={handleReverse}
                title="Reverse all pages"
                aria-label="Reverse all pages"
              >
                <ArrowUpDown size={14} />
                Reverse
              </button>

              {isOrderChanged && (
                <button
                  type="button"
                  className="btn btn-secondary sm"
                  onClick={handleReset}
                  title="Reset to original order"
                  aria-label="Reset to original order"
                >
                  <RefreshCw size={14} />
                  Reset
                </button>
              )}
            </div>
          )}
        </div>

        {pageError && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontSize: '13px',
            }}
          >
            {pageError}
          </div>
        )}

        {pageCount === null && !pageError && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Loading document pages...
          </div>
        )}

        {pageCount !== null && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: '12px',
              maxHeight: '520px',
              overflowY: 'auto',
              padding: '4px',
            }}
          >
            {pageOrder.map((originalIndex, currentPos) => {
              const isDragging = draggedIndex === currentPos;
              const isOver = dragOverIndex === currentPos;
              const isMoved = originalIndex !== currentPos;

              return (
                <div
                  key={`${originalIndex}-${currentPos}`}
                  draggable
                  onDragStart={() => handleDragStart(currentPos)}
                  onDragOver={(e) => handleDragOver(e, currentPos)}
                  onDrop={() => handleDrop(currentPos)}
                  onDragEnd={handleDragEnd}
                  style={{
                    border: isOver
                      ? '2px solid var(--accent)'
                      : isMoved
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    background: isMoved ? 'var(--accent-surface, var(--surface-2))' : 'var(--surface)',
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'grab',
                    opacity: isDragging ? 0.4 : 1,
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* Thumbnail / Page Icon Placeholder */}
                  <div
                    style={{
                      width: '100%',
                      height: showThumbnails ? '120px' : '60px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-2)',
                      border: '1px dashed var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                    }}
                  >
                    <FileText size={showThumbnails ? 28 : 20} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>
                      Page {originalIndex + 1}
                    </span>
                  </div>

                  {/* Position Badge & Controls */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      fontSize: '11px',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: isMoved ? 'var(--accent)' : 'var(--text-muted)' }}>
                      #{currentPos + 1}
                    </span>

                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="reorder-move-btn"
                        aria-label={`Move page ${originalIndex + 1} earlier`}
                        disabled={currentPos === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMove(currentPos, currentPos - 1);
                        }}
                      >
                        <ArrowUp size={16} />
                      </button>

                      <button
                        type="button"
                        className="reorder-move-btn"
                        aria-label={`Move page ${originalIndex + 1} later`}
                        disabled={currentPos === pageOrder.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMove(currentPos, currentPos + 1);
                        }}
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Column: Options & Action */}
      <div className="card opts">
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

        <div style={{ marginTop: '6px', marginBottom: '8px', width: '100%', minWidth: 0, maxWidth: '100%' }}>
          <OutputFilenameInput
            value={outputBaseName ?? ''}
            onChange={onOutputBaseNameChange ?? (() => {})}
            placeholder={defaultBaseName ?? 'reordered'}
            extension={outputExtension ?? '.pdf'}
          />
        </div>

        <button
          type="button"
          className="cta"
          onClick={handleRun}
          disabled={isProcessing || !file || pageCount === null || pageCount <= 1}
        >
          <Grid size={16} style={{ flexShrink: 0 }} />
          <span>{isProcessing ? 'Reordering...' : 'Reorder PDF'}</span>
        </button>
      </div>
    </>
  );
}
