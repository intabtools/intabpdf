import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { StagedFile } from '../tools/types';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  return Math.round(bytes / 1024) + ' KB';
}

export interface ImagePreviewModalProps {
  files: StagedFile[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
}

export default function ImagePreviewModal({
  files,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
}: ImagePreviewModalProps): ReactNode {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const currentFile = files[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < files.length - 1;

  // Manage object URL lifecycle: assign directly to img element, revoke on change or unmount
  useEffect(() => {
    if (!isOpen || !currentFile?.bytes || !imgRef.current) return;

    const blob = new Blob([currentFile.bytes as BlobPart]);
    const url = URL.createObjectURL(blob);
    imgRef.current.src = url;

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [isOpen, currentFile]);

  // Manage focus restoration & keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        if (hasPrev) {
          e.preventDefault();
          onNavigate(currentIndex - 1);
        }
      } else if (e.key === 'ArrowRight') {
        if (hasNext) {
          e.preventDefault();
          onNavigate(currentIndex + 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, currentIndex, hasPrev, hasNext, onClose, onNavigate]);

  if (!isOpen || !currentFile) {
    return null;
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;

    if (diff > 50 && hasPrev) {
      onNavigate(currentIndex - 1);
    } else if (diff < -50 && hasNext) {
      onNavigate(currentIndex + 1);
    }
  };

  return (
    <div
      className="lightbox-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${currentFile.name}`}
      onClick={onClose}
    >
      {/* Header Bar */}
      <div
        className="lightbox-hdr"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lightbox-title">
          <span className="badge-page">Page {currentIndex + 1} of {files.length}</span>
          <b title={currentFile.name}>{currentFile.name}</b>
          <small style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}>
            ({formatBytes(currentFile.size)})
          </small>
        </div>

        <button
          ref={closeButtonRef}
          type="button"
          className="ib"
          onClick={onClose}
          aria-label="Close image preview"
          style={{ color: '#ffffff', width: '38px', height: '38px' }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Main Image View & Navigation Controls */}
      <div
        className="lightbox-body"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={onClose}
      >
        {hasPrev && (
          <button
            type="button"
            className="lightbox-nav-btn prev"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex - 1);
            }}
            aria-label="Previous image"
            title="Previous image (Left Arrow)"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        <img
          ref={imgRef}
          alt={currentFile.name}
          className="lightbox-img"
          onClick={(e) => e.stopPropagation()}
        />

        {hasNext && (
          <button
            type="button"
            className="lightbox-nav-btn next"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex + 1);
            }}
            aria-label="Next image"
            title="Next image (Right Arrow)"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>
    </div>
  );
}
