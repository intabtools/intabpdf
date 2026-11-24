// Tool module for stamping a visual signature and optional date onto a PDF document.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode, TouchEvent as ReactTouchEvent } from 'react';
import { AlertCircle, Calendar, Check, Edit3, Image, RotateCcw, Type } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { getPdfPageCount } from '../../core/split';
import type { SignaturePosition, SignOptions } from '../../core/sign';
import { pdfProcessingService } from '../../core/worker/service';

type SignatureMode = 'draw' | 'type' | 'upload';

export default function SignTool({
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
  const [targetPage, setTargetPage] = useState<string>('last');
  const [position, setPosition] = useState<SignaturePosition>('bottom-right');
  const [mode, setMode] = useState<SignatureMode>('draw');
  const [typedName, setTypedName] = useState('Jane Doe');
  const [uploadedImageBytes, setUploadedImageBytes] = useState<Uint8Array | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [addDate, setAddDate] = useState<boolean>(() => optionsState['add-date'] ?? true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const file = stagedFiles[0];
  const [prevFileId, setPrevFileId] = useState<string | undefined>(file?.id);

  if (file?.id !== prevFileId) {
    setPrevFileId(file?.id);
    if (!file?.bytes) {
      setPageCount(null);
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
        },
        () => {
          if (!active) return;
          setPageCount(null);
        }
      );
    }

    return () => {
      active = false;
    };
  }, [file]);

  const toggleOption = (id: string) => {
    const nextVal = !(optionsState[id] ?? (id === 'add-date' ? addDate : false));
    onOptionsChange({
      ...optionsState,
      [id]: nextVal,
    });
    if (id === 'add-date') {
      setAddDate(nextVal);
    }
  };

  // Drawing canvas logic
  const startDrawing = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    setHasDrawn(true);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const draw = (x: number, y: number) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    startDrawing(x, y);
  };

  const handleMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    draw(x, y);
  };

  const handleTouchStart = (e: ReactTouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      const { x, y } = getCanvasCoords(e.touches[0].clientX, e.touches[0].clientY);
      startDrawing(x, y);
    }
  };

  const handleTouchMove = (e: ReactTouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      const { x, y } = getCanvasCoords(e.touches[0].clientX, e.touches[0].clientY);
      draw(x, y);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const uploaded = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        setUploadedImageBytes(new Uint8Array(reader.result));
      }
    };
    reader.readAsArrayBuffer(uploaded);
    e.target.value = '';
  };

  // Convert canvas / typed text to PNG bytes
  const getSignatureBytes = async (): Promise<Uint8Array | null> => {
    if (mode === 'upload') {
      return uploadedImageBytes;
    }

    if (mode === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) return null;
      return new Promise<Uint8Array | null>((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
              resolve(new Uint8Array(reader.result));
            } else {
              resolve(null);
            }
          };
          reader.readAsArrayBuffer(blob);
        }, 'image/png');
      });
    }

    if (mode === 'type') {
      if (!typedName.trim()) return null;
      // Render cursive text to offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = 400;
      offscreen.height = 120;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return null;

      ctx.clearRect(0, 0, offscreen.width, offscreen.height);
      ctx.font = 'italic 44px "Brush Script MT", "Caveat", "Segoe Script", cursive, sans-serif';
      ctx.fillStyle = '#1a202c';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(typedName.trim(), offscreen.width / 2, offscreen.height / 2);

      return new Promise<Uint8Array | null>((resolve) => {
        offscreen.toBlob((blob) => {
          if (!blob) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
              resolve(new Uint8Array(reader.result));
            } else {
              resolve(null);
            }
          };
          reader.readAsArrayBuffer(blob);
        }, 'image/png');
      });
    }

    return null;
  };

  const isSignatureReady = useMemo(() => {
    if (mode === 'draw') return hasDrawn;
    if (mode === 'type') return typedName.trim().length > 0;
    if (mode === 'upload') return uploadedImageBytes !== null;
    return false;
  }, [mode, hasDrawn, typedName, uploadedImageBytes]);

  const handleRun = async () => {
    if (!file?.bytes || !isSignatureReady || isProcessing) return;

    const signatureBytes = await getSignatureBytes();
    if (!signatureBytes) return;

    const resolvedPageIndex =
      targetPage === 'first'
        ? 0
        : targetPage === 'last'
        ? (pageCount ? pageCount - 1 : 0)
        : Math.max(0, parseInt(targetPage, 10) - 1);

    const signOptions: SignOptions = {
      pageIndex: resolvedPageIndex,
      position,
      addDate,
      dateText: new Date().toISOString().slice(0, 10),
    };

    await onExecute(async (signal) => {
      return await pdfProcessingService.execute(
        'sign',
        {
          buffer: file.bytes,
          signatureBytes,
          options: signOptions,
        },
        { signal }
      );
    });
  };

  return (
    <>
      {/* Left Column: Signature Creation Studio */}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Edit3 size={18} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Create Signature</h3>
          </div>

          {/* Mode Selector Tabs */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className={`btn btn-secondary ${mode === 'draw' ? 'active' : ''}`}
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: mode === 'draw' ? 'var(--accent)' : undefined,
                color: mode === 'draw' ? '#fff' : undefined,
              }}
              onClick={() => setMode('draw')}
            >
              <Edit3 size={12} />
              Draw
            </button>
            <button
              type="button"
              className={`btn btn-secondary ${mode === 'type' ? 'active' : ''}`}
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: mode === 'type' ? 'var(--accent)' : undefined,
                color: mode === 'type' ? '#fff' : undefined,
              }}
              onClick={() => setMode('type')}
            >
              <Type size={12} />
              Type
            </button>
            <button
              type="button"
              className={`btn btn-secondary ${mode === 'upload' ? 'active' : ''}`}
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: mode === 'upload' ? 'var(--accent)' : undefined,
                color: mode === 'upload' ? '#fff' : undefined,
              }}
              onClick={() => setMode('upload')}
            >
              <Image size={12} />
              Upload
            </button>
          </div>
        </div>

        {/* Draw Mode: Canvas Pad */}
        {mode === 'draw' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                position: 'relative',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: '#ffffff',
                overflow: 'hidden',
                touchAction: 'none',
              }}
            >
              <canvas
                ref={canvasRef}
                width={460}
                height={160}
                style={{
                  width: '100%',
                  height: '160px',
                  display: 'block',
                  cursor: 'crosshair',
                  userSelect: 'none',
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={stopDrawing}
              />
              {!hasDrawn && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                >
                  Sign with mouse or touch here
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary sm"
                onClick={clearCanvas}
                disabled={!hasDrawn}
                aria-label="Clear signature canvas"
              >
                <RotateCcw size={13} />
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Type Mode: Custom Cursive Generator */}
        {mode === 'type' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Your Name
              </label>
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Type your name..."
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '13px',
                  userSelect: 'text',
                }}
              />
            </div>

            <div
              style={{
                height: '110px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px',
                fontFamily: 'italic 38px "Brush Script MT", "Caveat", "Segoe Script", cursive, sans-serif',
                fontSize: '36px',
                color: '#1a202c',
                userSelect: 'none',
              }}
            >
              {typedName.trim() || 'Signature Preview'}
            </div>
          </div>
        )}

        {/* Upload Mode: Image File Picker */}
        {mode === 'upload' && (
          <div
            style={{
              borderRadius: 'var(--radius-md)',
              border: '2px dashed var(--border)',
              padding: '24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
              id="signature-image-upload"
            />
            <label
              htmlFor="signature-image-upload"
              className="btn btn-secondary"
              style={{ cursor: 'pointer' }}
            >
              <Image size={15} />
              Choose signature image
            </label>
            <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              Supports transparent PNG, JPEG, or WebP
            </small>

            {uploadedImageBytes && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: 'var(--accent)',
                  fontSize: '12px',
                  fontWeight: 600,
                  marginTop: '4px',
                }}
              >
                <Check size={14} />
                Image loaded ({uploadedImageBytes.length} bytes)
              </div>
            )}
          </div>
        )}

        {/* Visual Signature Notice */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontSize: '12px',
            lineHeight: 1.5,
            color: 'var(--text-muted)',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
          }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent)' }} />
          <div>
            <strong>Visual Signature Stamp:</strong> This adds a visual image stamp to your PDF page. It is not a cryptographic PKI digital certificate.
          </div>
        </div>
      </div>

      {/* Right Column: Placement Options & Action */}
      <div className="card opts">
        {/* Target Page Selector */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Sign Page
          </label>
          <select
            value={targetPage}
            onChange={(e) => setTargetPage(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '12px',
            }}
          >
            <option value="last">Last page {pageCount ? `(Page ${pageCount})` : ''}</option>
            <option value="first">First page (Page 1)</option>
            {pageCount && pageCount > 2 &&
              Array.from({ length: pageCount - 2 }, (_, i) => i + 2).map((p) => (
                <option key={p} value={String(p)}>
                  Page {p}
                </option>
              ))}
          </select>
        </div>

        {/* Position Preset */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Position
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {(
              [
                ['bottom-right', 'Bottom Right'],
                ['bottom-left', 'Bottom Left'],
                ['bottom-center', 'Bottom Center'],
                ['top-right', 'Top Right'],
              ] as const
            ).map(([posKey, posLabel]) => (
              <button
                key={posKey}
                type="button"
                className={`btn btn-secondary ${position === posKey ? 'active' : ''}`}
                style={{
                  fontSize: '11px',
                  padding: '6px',
                  fontWeight: position === posKey ? 600 : 400,
                  background: position === posKey ? 'var(--accent)' : undefined,
                  color: position === posKey ? '#fff' : undefined,
                }}
                onClick={() => setPosition(posKey)}
              >
                {posLabel}
              </button>
            ))}
          </div>
        </div>

        {/* Add Date Option Switch */}
        <div className="sw" style={{ marginTop: '4px' }}>
          <span>
            Add today date
            <small>Put date stamp next to signature</small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={addDate}
            aria-label="Add today date"
            className={`tg ${addDate ? 'on' : ''}`}
            onClick={() => toggleOption('date')}
          />
        </div>

        {/* Output filename input */}
        <div style={{ marginTop: '4px', marginBottom: '4px' }}>
          <OutputFilenameInput
            value={outputBaseName ?? ''}
            onChange={onOutputBaseNameChange ?? (() => {})}
            placeholder={defaultBaseName ?? 'signed'}
            extension={outputExtension ?? '.pdf'}
          />
        </div>

        <button
          type="button"
          className="cta"
          onClick={handleRun}
          disabled={isProcessing || !file || !isSignatureReady}
        >
          <Calendar size={16} style={{ flexShrink: 0 }} />
          <span>{isProcessing ? 'Signing...' : 'Sign PDF'}</span>
        </button>
      </div>
    </>
  );
}
