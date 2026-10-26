// List of staged files with drag-and-drop, touch fling, and keyboard reordering support.
import { useEffect, useRef } from 'react';
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, TouchEvent } from 'react';
import { ChevronDown, ChevronUp, FileText, GripVertical, X } from 'lucide-react';
import { formatBytes } from '../../core';
import type { StagedFile } from '../../tools/types';

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
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'cover',
        borderRadius: '2px',
      }}
    />
  );
}

interface StagedFileListProps {
  toolId: string;
  stagedFiles: StagedFile[];
  draggedIndex: number | null;
  dragOver: { index: number; position: 'before' | 'after' } | null;
  onDragStart: (e: DragEvent, index: number) => void;
  onDragOver: (e: DragEvent, index: number) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent, index: number) => void;
  onDragEnd: () => void;
  onTouchStartGrip: (e: TouchEvent, index: number) => void;
  onTouchMoveGrip: (e: TouchEvent) => void;
  onTouchEndGrip: () => void;
  onGripKeyDown: (e: ReactKeyboardEvent, index: number) => void;
  onPreviewImage: (index: number) => void;
  onMoveFile: (index: number, direction: 'up' | 'down') => void;
  onRemoveFile: (id: string) => void;
}

export default function StagedFileList({
  toolId,
  stagedFiles,
  draggedIndex,
  dragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onTouchStartGrip,
  onTouchMoveGrip,
  onTouchEndGrip,
  onGripKeyDown,
  onPreviewImage,
  onMoveFile,
  onRemoveFile,
}: StagedFileListProps): ReactNode {
  return (
    <div>
      {stagedFiles.map((file, index) => {
        const isFileImage = Boolean(
          file.name.match(/\.(jpe?g|png|webp|gif|bmp)$/i) && file.bytes
        );
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
            onDragStart={(e) => onDragStart(e, index)}
            onDragOver={(e) => onDragOver(e, index)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, index)}
            onDragEnd={onDragEnd}
            className={`card fi ${draggedIndex === index ? 'dragging' : ''} ${dragOverClass}`}
          >
            <span
              className="gr"
              tabIndex={0}
              role="button"
              aria-label={`Reorder ${file.name}. Press Alt+Up or Alt+Down to move.`}
              title="Drag to reorder (Alt+Up / Alt+Down)"
              onTouchStart={(e) => onTouchStartGrip(e, index)}
              onTouchMove={onTouchMoveGrip}
              onTouchEnd={onTouchEndGrip}
              onTouchCancel={onTouchEndGrip}
              onKeyDown={(e) => onGripKeyDown(e, index)}
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
                    onPreviewImage(index);
                  }
                }}
                disabled={!isFileImage}
                aria-label={isFileImage ? `Preview ${file.name}` : undefined}
                title={isFileImage ? `Click to preview ${file.name}` : undefined}
                draggable={false}
              >
                <div className="pg">
                  <div
                    className="pgi"
                    style={{
                      overflow: 'hidden',
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    <ThumbnailPreview file={file} />
                  </div>
                </div>
              </button>
            </span>

            <span className="nm">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, maxWidth: '100%' }}>
                {toolId === 'images-to-pdf' && (
                  <span
                    className="badge-page"
                    title={`Page ${index + 1} of ${stagedFiles.length} in output PDF`}
                    style={{ flexShrink: 0 }}
                  >
                    Page {index + 1}
                  </span>
                )}
                <b
                  title={file.name}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.name}
                </b>
              </div>
              <small>{formatBytes(file.size)}</small>
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {stagedFiles.length > 1 && (
                <>
                  <button
                    type="button"
                    className="ib sm"
                    onClick={() => onMoveFile(index, 'up')}
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
                    onClick={() => onMoveFile(index, 'down')}
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
                onClick={() => onRemoveFile(file.id)}
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
    </div>
  );
}
