import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';
import type { StagedFile } from '../tools/types';
import type { NormalizedRect } from '../tools/modules/imagesToPdf/imageFilters';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  return Math.round(bytes / 1024) + ' KB';
}

interface CropInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface CropDrawerProps {
  crop?: NormalizedRect;
  onApply: (crop: NormalizedRect) => void;
  onReset: () => void;
  onCancel: () => void;
  onLiveChange: (insets: CropInsets) => void;
}

function CropDrawer({
  crop,
  onApply,
  onReset,
  onCancel,
  onLiveChange,
}: CropDrawerProps): ReactNode {
  const [insetTop, setInsetTop] = useState(() => (crop ? Math.round(crop.y * 100) : 0));
  const [insetBottom, setInsetBottom] = useState(() =>
    crop ? Math.round((1 - crop.y - crop.h) * 100) : 0
  );
  const [insetLeft, setInsetLeft] = useState(() => (crop ? Math.round(crop.x * 100) : 0));
  const [insetRight, setInsetRight] = useState(() =>
    crop ? Math.round((1 - crop.x - crop.w) * 100) : 0
  );

  const handleTopChange = (v: number) => {
    setInsetTop(v);
    onLiveChange({ top: v, bottom: insetBottom, left: insetLeft, right: insetRight });
  };
  const handleBottomChange = (v: number) => {
    setInsetBottom(v);
    onLiveChange({ top: insetTop, bottom: v, left: insetLeft, right: insetRight });
  };
  const handleLeftChange = (v: number) => {
    setInsetLeft(v);
    onLiveChange({ top: insetTop, bottom: insetBottom, left: v, right: insetRight });
  };
  const handleRightChange = (v: number) => {
    setInsetRight(v);
    onLiveChange({ top: insetTop, bottom: insetBottom, left: insetLeft, right: v });
  };

  const handleApply = () => {
    const x = insetLeft / 100;
    const y = insetTop / 100;
    const w = Math.max(0.05, 1 - (insetLeft + insetRight) / 100);
    const h = Math.max(0.05, 1 - (insetTop + insetBottom) / 100);
    onApply({ x, y, w, h });
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'rgba(20, 20, 24, 0.95)',
        borderTop: '1px solid rgba(255, 255, 255, 0.15)',
        padding: '12px 20px',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 10,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          fontSize: '12px',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Top Inset ({insetTop}%)</span>
          <input
            type="range"
            min="0"
            max="45"
            value={insetTop}
            onChange={(e) => handleTopChange(Number(e.target.value))}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Bottom Inset ({insetBottom}%)</span>
          <input
            type="range"
            min="0"
            max="45"
            value={insetBottom}
            onChange={(e) => handleBottomChange(Number(e.target.value))}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Left Inset ({insetLeft}%)</span>
          <input
            type="range"
            min="0"
            max="45"
            value={insetLeft}
            onChange={(e) => handleLeftChange(Number(e.target.value))}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Right Inset ({insetRight}%)</span>
          <input
            type="range"
            min="0"
            max="45"
            value={insetRight}
            onChange={(e) => handleRightChange(Number(e.target.value))}
          />
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
        <button
          type="button"
          className="cta"
          onClick={onReset}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#fff',
            fontSize: '12px',
            padding: '6px 12px',
          }}
        >
          <RotateCcw size={14} />
          <span>Reset Crop</span>
        </button>
        <button
          type="button"
          className="cta"
          onClick={onCancel}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#fff',
            fontSize: '12px',
            padding: '6px 12px',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="cta"
          onClick={handleApply}
          style={{
            background: 'var(--primary, #3b82f6)',
            color: '#fff',
            fontSize: '12px',
            padding: '6px 14px',
          }}
        >
          <Check size={14} />
          <span>Apply Crop</span>
        </button>
      </div>
    </div>
  );
}

export interface ImagePreviewModalProps {
  files: StagedFile[];
  currentIndex: number;
  isOpen: boolean;
  imageEdits?: Record<string, { rotation?: number; crop?: NormalizedRect }>;
  onRotate?: (index: number) => void;
  onCrop?: (index: number, crop: NormalizedRect | null) => void;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
}

export default function ImagePreviewModal({
  files,
  currentIndex,
  isOpen,
  imageEdits,
  onRotate,
  onCrop,
  onClose,
  onNavigate,
}: ImagePreviewModalProps): ReactNode {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [isCropping, setIsCropping] = useState(false);
  const [liveInsets, setLiveInsets] = useState<CropInsets | null>(null);

  const currentFile = files[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < files.length - 1;

  const currentEdit = currentFile ? imageEdits?.[currentFile.id] : undefined;
  const rotation = currentEdit?.rotation || 0;

  // Manage object URL lifecycle
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
      if (e.target instanceof HTMLInputElement) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (isCropping) {
          setIsCropping(false);
          setLiveInsets(null);
        } else {
          onClose();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        if (onRotate) {
          e.preventDefault();
          onRotate(currentIndex);
        }
      } else if (e.key === 'c' || e.key === 'C') {
        if (onCrop) {
          e.preventDefault();
          setIsCropping((prev) => !prev);
          setLiveInsets(null);
        }
      } else if (e.key === 'ArrowLeft') {
        if (hasPrev && !isCropping) {
          e.preventDefault();
          onNavigate(currentIndex - 1);
        }
      } else if (e.key === 'ArrowRight') {
        if (hasNext && !isCropping) {
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
  }, [isOpen, currentIndex, hasPrev, hasNext, isCropping, onClose, onNavigate, onRotate, onCrop]);

  if (!isOpen || !currentFile) {
    return null;
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isCropping) return;
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isCropping || touchStartXRef.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;

    if (diff > 50 && hasPrev) {
      onNavigate(currentIndex - 1);
    } else if (diff < -50 && hasNext) {
      onNavigate(currentIndex + 1);
    }
  };

  const handleApplyCrop = (crop: NormalizedRect) => {
    if (!onCrop) return;
    onCrop(currentIndex, crop);
    setIsCropping(false);
    setLiveInsets(null);
  };

  const handleResetCrop = () => {
    if (!onCrop) return;
    onCrop(currentIndex, null);
    setIsCropping(false);
    setLiveInsets(null);
  };

  // Determine current active crop box for overlay
  const overlayTop =
    liveInsets !== null
      ? liveInsets.top
      : currentEdit?.crop
        ? Math.round(currentEdit.crop.y * 100)
        : 0;
  const overlayBottom =
    liveInsets !== null
      ? liveInsets.bottom
      : currentEdit?.crop
        ? Math.round((1 - currentEdit.crop.y - currentEdit.crop.h) * 100)
        : 0;
  const overlayLeft =
    liveInsets !== null
      ? liveInsets.left
      : currentEdit?.crop
        ? Math.round(currentEdit.crop.x * 100)
        : 0;
  const overlayRight =
    liveInsets !== null
      ? liveInsets.right
      : currentEdit?.crop
        ? Math.round((1 - currentEdit.crop.x - currentEdit.crop.w) * 100)
        : 0;

  return (
    <div
      className="lightbox-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${currentFile.name}`}
      onClick={() => {
        if (isCropping) {
          setIsCropping(false);
          setLiveInsets(null);
        } else {
          onClose();
        }
      }}
    >
      {/* Header Bar */}
      <div className="lightbox-hdr" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-title">
          <span className="badge-page">Page {currentIndex + 1} of {files.length}</span>
          <b title={currentFile.name}>{currentFile.name}</b>
          <small style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}>
            ({formatBytes(currentFile.size)})
          </small>
          {rotation !== 0 && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.2)',
                color: '#fff',
              }}
            >
              {rotation}°
            </span>
          )}
          {Boolean(currentEdit?.crop) && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(59, 130, 246, 0.5)',
                color: '#fff',
              }}
            >
              Cropped
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onRotate && (
            <button
              type="button"
              className="ib"
              onClick={() => onRotate(currentIndex)}
              aria-label="Rotate 90 degrees clockwise"
              title="Rotate 90° clockwise (R)"
              style={{ color: '#ffffff', width: '38px', height: '38px' }}
            >
              <RotateCw size={18} />
            </button>
          )}

          {onCrop && (
            <button
              type="button"
              className="ib"
              onClick={() => {
                setIsCropping((prev) => !prev);
                setLiveInsets(null);
              }}
              aria-label="Crop image"
              title="Crop image (C)"
              style={{
                color: isCropping ? 'var(--primary, #3b82f6)' : '#ffffff',
                background: isCropping ? 'rgba(255, 255, 255, 0.15)' : undefined,
                width: '38px',
                height: '38px',
              }}
            >
              <Crop size={18} />
            </button>
          )}

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
      </div>

      {/* Main Image View & Navigation Controls */}
      <div
        className="lightbox-body"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={onClose}
        style={{ position: 'relative' }}
      >
        {hasPrev && !isCropping && (
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

        <div
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxWidth: '90vw',
            maxHeight: '75vh',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            ref={imgRef}
            alt={currentFile.name}
            className="lightbox-img"
            style={{
              transform: rotation ? `rotate(${rotation}deg)` : undefined,
              transition: 'transform 0.15s ease',
              display: 'block',
              maxWidth: '90vw',
              maxHeight: '75vh',
              objectFit: 'contain',
            }}
          />

          {/* Interactive Crop Boundary Guide Overlay */}
          {(isCropping || currentEdit?.crop) && (
            <div
              style={{
                position: 'absolute',
                top: `${overlayTop}%`,
                bottom: `${overlayBottom}%`,
                left: `${overlayLeft}%`,
                right: `${overlayRight}%`,
                border: isCropping ? '2px dashed #3b82f6' : '1px solid rgba(59, 130, 246, 0.5)',
                boxShadow: isCropping ? '0 0 0 9999px rgba(0, 0, 0, 0.5)' : undefined,
                pointerEvents: 'none',
                transition: 'all 0.1s ease',
              }}
            />
          )}
        </div>

        {hasNext && !isCropping && (
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

      {/* Crop Controls Drawer when isCropping */}
      {isCropping && (
        <CropDrawer
          key={`${currentIndex}-${currentEdit?.crop ? 'c' : 'n'}`}
          crop={currentEdit?.crop}
          onApply={handleApplyCrop}
          onReset={handleResetCrop}
          onCancel={() => {
            setIsCropping(false);
            setLiveInsets(null);
          }}
          onLiveChange={setLiveInsets}
        />
      )}
    </div>
  );
}
