// Tool module for converting image files (JPEG, PNG, WebP) to a single PDF document.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FileImage, Info } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import SegmentedControl from '../../components/SegmentedControl';
import type { ToolComponentProps } from '../types';
import type {
  ImageFit,
  MarginPreset,
  PageBackground,
  PageOrientation,
  PageSize,
} from '../../core/images-to-pdf';
import { pdfProcessingService } from '../../core/worker/service';
import type { DocumentFilter, NormalizedRect, ProcessImageOptions } from './imagesToPdf/imageFilters';

export default function ImagesToPdfTool({
  tool,
  stagedFiles,
  optionsState,
  onOptionsChange,
  onExecute,
  isProcessing,
  extraState,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [orientation, setOrientation] = useState<PageOrientation>('portrait');
  const [imageFit, setImageFit] = useState<ImageFit>('contain');
  const [backgroundColor, setBackgroundColor] = useState<PageBackground>('white');
  const [margin, setMargin] = useState<MarginPreset>('none');
  const [filter, setFilter] = useState<DocumentFilter>('none');
  const [addPageNumbers, setAddPageNumbers] = useState(false);

  const imageEdits = useMemo(() => {
    return (
      (extraState?.imageEdits as Record<
        string,
        { rotation?: number; crop?: NormalizedRect }
      >) || {}
    );
  }, [extraState]);

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const fileCount = stagedFiles.length;

  // Resolve dynamic auto-orientation preview based on final effective dimensions
  const resolvedAutoOrientation = useMemo(() => {
    if (fileCount === 0) return 'portrait';
    let landscapeCount = 0;
    let portraitCount = 0;

    for (const f of stagedFiles) {
      const edit = imageEdits[f.id];
      const rot = (((edit?.rotation || 0) % 360) + 360) % 360;
      const isRot90or270 = rot === 90 || rot === 270;
      const crop = edit?.crop;

      // Default aspect ratio heuristic if dimensions not pre-cached
      let effW = isRot90or270 ? 3 : 4;
      let effH = isRot90or270 ? 4 : 3;

      if (crop) {
        effW = Math.max(1, Math.round(effW * crop.w));
        effH = Math.max(1, Math.round(effH * crop.h));
      }

      if (effW > effH) {
        landscapeCount++;
      } else {
        portraitCount++;
      }
    }

    return landscapeCount > portraitCount ? 'landscape' : 'portrait';
  }, [fileCount, stagedFiles, imageEdits]);

  const handleRun = async () => {
    if (stagedFiles.length === 0 || isProcessing) return;

    await onExecute(async (signal) => {
      const shouldShrink = optionsState['shrink'] ?? false;

      // Dynamic import of image processing helpers on demand
      const hasWebp = stagedFiles.some((f) => {
        const b = f.bytes;
        return (
          b.length >= 12 &&
          b[0] === 0x52 &&
          b[1] === 0x49 &&
          b[2] === 0x46 &&
          b[3] === 0x46 &&
          b[8] === 0x57 &&
          b[9] === 0x45 &&
          b[10] === 0x42 &&
          b[11] === 0x50
        );
      });

      let convertWebpToPng: ((b: Uint8Array) => Promise<Uint8Array>) | null = null;
      if (hasWebp) {
        const webpMod = await import('./imagesToPdf/webpConverter');
        convertWebpToPng = webpMod.convertWebpToPng;
      }

      const hasEditsOrFilter =
        filter !== 'none' ||
        shouldShrink ||
        Object.keys(imageEdits).some((id) => {
          const e = imageEdits[id];
          return (e?.rotation && e.rotation !== 0) || Boolean(e?.crop);
        });

      let processImageWithEdits:
        | ((
            bytes: Uint8Array,
            name: string,
            opts?: ProcessImageOptions
          ) => Promise<Uint8Array>)
        | null = null;

      if (hasEditsOrFilter) {
        const filtersMod = await import('./imagesToPdf/imageFilters');
        processImageWithEdits = filtersMod.processImageWithEdits;
      }

      const processedImages = await Promise.all(
        stagedFiles.map(async (f) => {
          if (signal?.aborted) {
            throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
          }
          let bytes = f.bytes;

          // Convert WebP to PNG if needed (pdf-lib only embeds PNG/JPEG)
          if (
            convertWebpToPng &&
            bytes.length >= 12 &&
            bytes[0] === 0x52 &&
            bytes[1] === 0x49 &&
            bytes[2] === 0x46 &&
            bytes[3] === 0x46 &&
            bytes[8] === 0x57 &&
            bytes[9] === 0x45 &&
            bytes[10] === 0x42 &&
            bytes[11] === 0x50
          ) {
            bytes = await convertWebpToPng(bytes);
          }

          const edit = imageEdits[f.id];
          const fileRotation = edit?.rotation || 0;
          const fileCrop = edit?.crop;

          // Single-pass canvas processing if crop, filter, or shrink are active
          if (processImageWithEdits && (fileCrop || filter !== 'none' || shouldShrink)) {
            bytes = await processImageWithEdits(bytes, f.name, {
              rotation: fileRotation,
              crop: fileCrop,
              filter,
              shrink: shouldShrink,
              maxDimension: 1920,
              quality: 0.92,
            });
            return {
              name: f.name,
              bytes,
              rotation: 0, // Rotation already applied in canvas single-pass
            };
          }

          // If only rotated (no crop/filter/shrink), pass native rotation directly to pdf-lib
          return {
            name: f.name,
            bytes,
            rotation: fileRotation,
          };
        })
      );

      return await pdfProcessingService.execute(
        'images-to-pdf',
        {
          images: processedImages,
          options: {
            pageSize,
            orientation,
            imageFit,
            backgroundColor: imageFit === 'cover' ? 'white' : backgroundColor,
            margin,
            addPageNumbers,
          },
        },
        { signal }
      );
    });
  };

  return (
    <div className="card opts">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <b>{tool.name} options</b>
        {fileCount > 0 && (
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
            {fileCount} {fileCount === 1 ? 'image' : 'images'} selected
          </span>
        )}
      </div>

      {/* Page Size Selector */}
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
        }}
      >
        <span id="images-page-size-label">
          Page size & layout
          <small>Document paper dimensions</small>
        </span>
        <SegmentedControl<PageSize>
          ariaLabelledBy="images-page-size-label"
          size="sm"
          value={pageSize}
          onChange={setPageSize}
          options={[
            { value: 'a4', label: 'A4 paper (Standard)' },
            { value: 'fit', label: 'Fit to photo (Natural)' },
          ]}
        />
      </div>

      {/* Orientation Selector (for A4) */}
      {pageSize === 'a4' && (
        <div
          className="sw"
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '8px',
            marginTop: '6px',
          }}
        >
          <span id="images-orientation-label">
            Orientation
            <small>Uniform orientation for all A4 pages</small>
          </span>
          <SegmentedControl<PageOrientation>
            ariaLabelledBy="images-orientation-label"
            size="sm"
            value={orientation}
            onChange={setOrientation}
            options={[
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
              { value: 'auto', label: `Auto (${resolvedAutoOrientation})` },
            ]}
          />
        </div>
      )}

      {/* Image Fitting Selector */}
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          marginTop: '6px',
        }}
      >
        <span id="images-fit-label">
          Image fit
          <small>How images scale to the page boundaries</small>
        </span>
        <SegmentedControl<ImageFit>
          ariaLabelledBy="images-fit-label"
          size="sm"
          value={imageFit}
          onChange={setImageFit}
          options={[
            { value: 'contain', label: 'Contain (Full photo)' },
            { value: 'cover', label: 'Cover (Fill page)' },
          ]}
        />
      </div>

      {/* Page Background (active in Contain mode) */}
      {imageFit === 'contain' && (
        <div
          className="sw"
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '8px',
            marginTop: '6px',
          }}
        >
          <span id="images-bg-label">
            Page background
            <small>Color for margins and unused space</small>
          </span>
          <SegmentedControl<PageBackground>
            ariaLabelledBy="images-bg-label"
            size="sm"
            value={backgroundColor}
            onChange={setBackgroundColor}
            options={[
              { value: 'white', label: 'White' },
              { value: 'black', label: 'Black' },
            ]}
          />
        </div>
      )}

      {/* Margin Presets */}
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          marginTop: '6px',
        }}
      >
        <span id="images-margins-label">
          Page margins
          <small>Padding around each photo</small>
        </span>
        <SegmentedControl<MarginPreset>
          ariaLabelledBy="images-margins-label"
          size="sm"
          value={margin}
          onChange={setMargin}
          options={[
            { value: 'none', label: 'None' },
            { value: 'small', label: 'Small' },
            { value: 'standard', label: 'Standard' },
          ]}
        />
      </div>

      {/* Document Filters */}
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          marginTop: '6px',
        }}
      >
        <span id="images-filter-label">
          Document filter
          <small>Enhance readability for notes, receipts, and scans</small>
        </span>
        <SegmentedControl<DocumentFilter>
          ariaLabelledBy="images-filter-label"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'none', label: 'Original color' },
            { value: 'grayscale', label: 'Grayscale' },
            { value: 'clean-bw', label: 'Clean B&W' },
          ]}
        />
      </div>

      {/* Page Numbers Switch */}
      <div className="sw" style={{ marginTop: '8px' }}>
        <span>
          Add page numbers
          <small>Prints centered page numbers (1 / {fileCount || 'N'}) at the bottom</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={addPageNumbers}
          aria-label="Add page numbers"
          className={`tg ${addPageNumbers ? 'on' : ''}`}
          onClick={() => setAddPageNumbers((prev) => !prev)}
        />
      </div>

      {/* Tool Definition Options (e.g. shrink large photos, disabled by default) */}
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

      {fileCount > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-2)',
            color: 'var(--text-muted)',
            fontSize: '12px',
            marginTop: '8px',
          }}
        >
          <Info size={14} style={{ flexShrink: 0 }} />
          <span>
            {pageSize === 'a4'
              ? `Creating ${fileCount} uniform A4 ${
                  orientation === 'auto'
                    ? `${resolvedAutoOrientation} (auto-detected)`
                    : orientation
                } ${fileCount === 1 ? 'page' : 'pages'}.`
              : `Creating ${fileCount} ${
                  fileCount === 1 ? 'page' : 'pages'
                } sized proportionally to each photo's natural shape.`}
          </span>
        </div>
      )}

      <div className="opts-filename">
        <OutputFilenameInput
          value={outputBaseName ?? ''}
          onChange={onOutputBaseNameChange ?? (() => {})}
          placeholder={defaultBaseName ?? 'images-to-pdf'}
          extension={outputExtension ?? '.pdf'}
        />
      </div>

      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={isProcessing || fileCount === 0}
      >
        <FileImage size={16} />
        <span>
          {isProcessing
            ? 'Creating PDF...'
            : `Create PDF from ${fileCount} ${fileCount === 1 ? 'photo' : 'photos'}`}
        </span>
      </button>
    </div>
  );
}
