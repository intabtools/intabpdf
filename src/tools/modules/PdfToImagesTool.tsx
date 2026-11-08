// Tool module for converting PDF pages into PNG or JPEG images.
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, FileImage, Image as ImageIcon, Info, Layers, Sliders } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import { ProcessingContext } from '../../components/processingContextDef';
import { useToast } from '../../hooks/useToast';
import { getPdfPageCount } from '../../core';
import type { ToolComponentProps } from '../types';
import { parseImagePageSelection } from './pdfToImages/pageSelection';
import { renderPdfToImages } from './pdfToImages/renderer';
import { executeBatchOperation } from '../batchOperation';
import { getCleanBaseName } from '../filename';
import {
  JPEG_QUALITY_PRESETS,
  LARGE_BATCH_THRESHOLD_3X,
  RESOLUTION_PRESETS,
  type ImageFormat,
  type ResolutionPreset,
} from './pdfToImages/types';

export default function PdfToImagesTool({
  tool,
  stagedFiles,
  onExecute,
  isProcessing,
  onExtraStateChange,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
}: ToolComponentProps): ReactNode {
  const file = stagedFiles[0];
  const isMultiFile = stagedFiles.length > 1;
  const { showToast } = useToast();
  const processing = useContext(ProcessingContext);

  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Tool state
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState<ResolutionPreset>(2); // High 2x by default
  const [jpegQuality, setJpegQuality] = useState<number>(0.85); // High 85% by default
  const [pageSelectionMode, setPageSelectionMode] = useState<'all' | 'range'>('all');
  const [rangeInput, setRangeInput] = useState('');

  const activeAbortControllerRef = useRef<AbortController | null>(null);

  // Determine total page count of staged PDF
  useEffect(() => {
    let active = true;

    if (file?.bytes) {
      void getPdfPageCount(file.bytes).then(
        (count) => {
          if (!active) return;
          setPageCount(count);
          setPageError(null);
        },
        (err: unknown) => {
          if (!active) return;
          setPageCount(null);
          setPageError(err instanceof Error ? err.message : 'Failed to inspect PDF');
        }
      );
    }

    return () => {
      active = false;
    };
  }, [file]);

  const effectivePageCount = file?.bytes ? pageCount : null;
  const effectivePageError = file?.bytes ? pageError : null;

  // Compute selected pages based on mode and input
  const selectionValidation = useMemo(() => {
    if (effectivePageCount === null) return { pages: [] };
    if (pageSelectionMode === 'all') {
      const allPages: number[] = [];
      for (let i = 1; i <= effectivePageCount; i++) allPages.push(i);
      return { pages: allPages };
    }
    return parseImagePageSelection(rangeInput, effectivePageCount);
  }, [pageSelectionMode, rangeInput, effectivePageCount]);

  const selectedPagesCount = selectionValidation.pages.length;
  const isSinglePage = !isMultiFile && selectedPagesCount === 1;

  // Expected output extension for the current configuration
  const currentOutputExt = isMultiFile ? '.zip' : (isSinglePage ? (format === 'jpeg' ? '.jpg' : '.png') : '.zip');

  // Synchronize extension with parent ToolPage
  useEffect(() => {
    onExtraStateChange?.('outputExtension', currentOutputExt);
  }, [currentOutputExt, onExtraStateChange]);

  const handleRun = async () => {
    if (stagedFiles.length === 0 || isProcessing) return;
    if (!isMultiFile && (!file || effectivePageCount === null)) return;
    if (pageSelectionMode === 'range' && (selectionValidation.error || selectedPagesCount === 0)) {
      return;
    }

    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    processing?.setCancelHandler?.(() => {
      abortController.abort();
    });

    try {
      await onExecute(async () => {
        if (!isMultiFile) {
          const result = await renderPdfToImages(file.bytes, {
            format,
            scale,
            jpegQuality,
            pages: selectionValidation.pages,
            signal: abortController.signal,
            onProgress: (progress) => {
              processing?.updateMessage?.(
                `Converting page ${progress.current} of ${progress.total} (${progress.percent}%)…`
              );
            },
          });

          onExtraStateChange?.('outputExtension', result.outputExtension);
          onExtraStateChange?.('imageCount', result.pageCount);
          onExtraStateChange?.('imageFormat', format.toUpperCase());
          onExtraStateChange?.('scale', scale);
          onExtraStateChange?.('isZip', result.isZip);

          return result.outputBytes;
        }

        let totalImageCount = 0;

        const zipBytes = await executeBatchOperation({
          actionVerb: 'Converting',
          stagedFiles,
          updateMessage: processing?.updateMessage,
          onExtraStateChange,
          signal: abortController.signal,
          processFile: async (curFile, fileIndex) => {
            const curDocPageCount = await getPdfPageCount(curFile.bytes);
            let targetPages: number[];

            if (pageSelectionMode === 'all') {
              targetPages = Array.from({ length: curDocPageCount }, (_, i) => i + 1);
            } else {
              const parsed = parseImagePageSelection(rangeInput, curDocPageCount);
              if (parsed.error || parsed.pages.length === 0) {
                throw new Error(parsed.error || 'No matching pages for range selection');
              }
              targetPages = parsed.pages;
            }

            const result = await renderPdfToImages(curFile.bytes, {
              format,
              scale,
              jpegQuality,
              pages: targetPages,
              signal: abortController.signal,
              onProgress: (progress) => {
                processing?.updateMessage?.(
                  `[${fileIndex + 1}/${stagedFiles.length}] Converting page ${progress.current} of ${progress.total} (${progress.percent}%)…`
                );
              },
            });

            totalImageCount += result.pageCount;
            const cleanBase = getCleanBaseName(curFile.name) || 'document';

            return result.images.map((img) => ({
              name: `${cleanBase}-${img.fileName}`,
              bytes: img.bytes,
            }));
          },
        });

        onExtraStateChange?.('outputExtension', '.zip');
        onExtraStateChange?.('imageCount', totalImageCount);
        onExtraStateChange?.('imageFormat', format.toUpperCase());
        onExtraStateChange?.('scale', scale);
        onExtraStateChange?.('isZip', true);

        return zipBytes;
      });
    } catch (err: unknown) {
      if (
        abortController.signal.aborted ||
        (err instanceof Error && err.message.toLowerCase().includes('cancel'))
      ) {
        showToast('Conversion cancelled');
      } else {
        showToast(err instanceof Error ? err.message : 'Conversion failed');
      }
      throw err;
    } finally {
      activeAbortControllerRef.current = null;
      processing?.setCancelHandler?.(null);
    }
  };

  const isInvalid = Boolean(
    pageSelectionMode === 'range' &&
      (selectionValidation.error || rangeInput.trim().length === 0 || selectedPagesCount === 0)
  );

  return (
    <div className="card opts">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <b>{tool.name} options</b>
        {isMultiFile ? (
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
            {`${stagedFiles.length} files selected`}
          </span>
        ) : effectivePageCount !== null ? (
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
            {effectivePageCount} {effectivePageCount === 1 ? 'page' : 'pages'} in document
          </span>
        ) : null}
      </div>

      {effectivePageError && (
        <div
          style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'flex-start',
            color: '#E81123',
            fontSize: '12px',
            marginBottom: '10px',
          }}
          role="alert"
        >
          <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
          <span>{effectivePageError}</span>
        </div>
      )}

      {/* 1. Format Selection (PNG vs JPEG) */}
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          width: '100%',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ImageIcon size={15} style={{ color: 'var(--accent)' }} />
          Image format
        </span>
        <div style={{ display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`tc ${format === 'png' ? 'active' : ''}`}
            onClick={() => setFormat('png')}
            style={{ flex: 1, minHeight: '38px', justifyContent: 'center' }}
          >
            PNG (Lossless)
          </button>
          <button
            type="button"
            className={`tc ${format === 'jpeg' ? 'active' : ''}`}
            onClick={() => setFormat('jpeg')}
            style={{ flex: 1, minHeight: '38px', justifyContent: 'center' }}
          >
            JPEG (Smaller file)
          </button>
        </div>
        <small style={{ color: 'var(--text-muted)', fontSize: '11.5px', marginTop: '-2px' }}>
          {format === 'png'
            ? 'Lossless quality, sharp text, crisp diagrams, and transparent artwork.'
            : 'Smaller file size, ideal for photo-heavy documents and web sharing.'}
        </small>
      </div>

      {/* 2. JPEG Quality Selector (Only when JPEG is selected) */}
      {format === 'jpeg' && (
        <div
          className="sw"
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '8px',
            width: '100%',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sliders size={15} style={{ color: 'var(--accent)' }} />
            JPEG quality
          </span>
          <div style={{ display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
            {JPEG_QUALITY_PRESETS.map((q) => (
              <button
                key={q.quality}
                type="button"
                className={`tc ${jpegQuality === q.quality ? 'active' : ''}`}
                onClick={() => setJpegQuality(q.quality)}
                style={{ flex: 1, minHeight: '36px', justifyContent: 'center', fontSize: '12.5px' }}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. Resolution Presets */}
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          width: '100%',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Layers size={15} style={{ color: 'var(--accent)' }} />
          Resolution
        </span>
        <div style={{ display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
          {RESOLUTION_PRESETS.map((r) => (
            <button
              key={r.scale}
              type="button"
              className={`tc ${scale === r.scale ? 'active' : ''}`}
              onClick={() => setScale(r.scale)}
              style={{ flex: 1, minHeight: '40px', justifyContent: 'center', fontSize: '12.5px' }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <small style={{ color: 'var(--text-muted)', fontSize: '11.5px', marginTop: '-2px' }}>
          {RESOLUTION_PRESETS.find((r) => r.scale === scale)?.description}. Higher resolution requires more memory.
        </small>
      </div>

      {/* 4. Page Selection (All pages vs Range) */}
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          width: '100%',
        }}
      >
        <span>Pages to convert</span>
        <div style={{ display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`tc ${pageSelectionMode === 'all' ? 'active' : ''}`}
            onClick={() => setPageSelectionMode('all')}
            style={{ flex: 1, minHeight: '38px', justifyContent: 'center' }}
          >
            All pages {effectivePageCount !== null ? `(${effectivePageCount})` : ''}
          </button>
          <button
            type="button"
            className={`tc ${pageSelectionMode === 'range' ? 'active' : ''}`}
            onClick={() => setPageSelectionMode('range')}
            style={{ flex: 1, minHeight: '38px', justifyContent: 'center' }}
          >
            Select range
          </button>
        </div>

        {pageSelectionMode === 'range' && (
          <div style={{ width: '100%', marginTop: '4px' }}>
            <input
              type="text"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              placeholder="e.g. 1-3, 5"
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                border:
                  rangeInput.trim().length > 0 && selectionValidation.error
                    ? '1px solid #E81123'
                    : '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />

            {rangeInput.trim().length > 0 && selectionValidation.error ? (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'flex-start',
                  color: '#E81123',
                  fontSize: '12px',
                  lineHeight: '1.4',
                  marginTop: '6px',
                }}
                role="alert"
              >
                <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>{selectionValidation.error}</span>
              </div>
            ) : selectionValidation.pages.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  color: 'var(--accent)',
                  fontSize: '12px',
                  marginTop: '6px',
                }}
              >
                <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                <span>
                  Will convert {selectionValidation.pages.length}{' '}
                  {selectionValidation.pages.length === 1 ? 'page' : 'pages'} (
                  {selectionValidation.pages.join(', ')}).
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Large batch memory advisory at 3x resolution */}
      {scale === 3 && selectedPagesCount >= LARGE_BATCH_THRESHOLD_3X && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: '12px',
            lineHeight: '1.45',
            marginTop: '8px',
            marginBottom: '4px',
          }}
          role="note"
        >
          <Info size={15} style={{ marginTop: '2px', flexShrink: 0, color: 'var(--accent)' }} />
          <span>
            Converting <b>{selectedPagesCount} pages</b> at <b>Very High (3×)</b> resolution generates high-density images that consume substantial memory. For faster processing and smaller files, consider <b>High (2×)</b> or <b>JPEG</b>.
          </span>
        </div>
      )}

      {/* 5. Custom Output Filename */}
      <div style={{ marginTop: '10px', marginBottom: '8px', width: '100%' }}>
        <OutputFilenameInput
          id="pdf-to-images-output-filename"
          value={outputBaseName ?? ''}
          onChange={onOutputBaseNameChange ?? (() => {})}
          placeholder={defaultBaseName ?? (isSinglePage ? 'page-001' : 'pdf-images')}
          extension={currentOutputExt}
        />
      </div>

      {/* 6. Action Button */}
      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={isProcessing || stagedFiles.length === 0 || (!isMultiFile && effectivePageCount === null) || isInvalid}
        style={{
          marginTop: '12px',
          width: '100%',
          minHeight: '44px',
        }}
      >
        <FileImage size={16} />
        <span>
          {isProcessing
            ? isMultiFile
              ? `Converting ${stagedFiles.length} files…`
              : 'Converting…'
            : isMultiFile
            ? `Convert ${stagedFiles.length} files to ${format.toUpperCase()}`
            : isSinglePage
            ? `Convert 1 page to ${format.toUpperCase()}`
            : `Convert ${selectedPagesCount || effectivePageCount || ''} pages to ${format.toUpperCase()}`}
        </span>
      </button>
    </div>
  );
}
