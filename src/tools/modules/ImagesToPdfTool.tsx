// Tool module for converting image files (JPEG, PNG, WebP) to a single PDF document.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { FileImage, Info } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { pdfProcessingService } from '../../core';
import type { MarginPreset, PageSizing } from '../../core';

export default function ImagesToPdfTool({
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
  const [pageSizing, setPageSizing] = useState<PageSizing>('fit');
  const [margin, setMargin] = useState<MarginPreset>('none');

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const handleRun = async () => {
    if (stagedFiles.length === 0 || isProcessing) return;

    await onExecute(async () => {
      return await pdfProcessingService.execute('images-to-pdf', {
        images: stagedFiles.map((f) => ({
          name: f.name,
          bytes: f.bytes,
        })),
        options: {
          pageSizing,
          margin,
        },
      });
    });
  };

  const fileCount = stagedFiles.length;

  return (
    <div className="card opts">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
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

      {/* Page Sizing Selector */}
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
        }}
      >
        <span>
          Page size & layout
          <small>How each photo is framed on the page</small>
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
          <button
            type="button"
            className="cta"
            onClick={() => setPageSizing('fit')}
            style={{
              background: pageSizing === 'fit' ? 'var(--text)' : 'var(--surface-2)',
              color: pageSizing === 'fit' ? 'var(--background)' : 'var(--text)',
              border: '1px solid var(--border)',
              padding: '8px 12px',
              fontSize: '13px',
              fontWeight: 500,
              justifyContent: 'center',
            }}
          >
            Fit image (Natural)
          </button>
          <button
            type="button"
            className="cta"
            onClick={() => setPageSizing('a4')}
            style={{
              background: pageSizing === 'a4' ? 'var(--text)' : 'var(--surface-2)',
              color: pageSizing === 'a4' ? 'var(--background)' : 'var(--text)',
              border: '1px solid var(--border)',
              padding: '8px 12px',
              fontSize: '13px',
              fontWeight: 500,
              justifyContent: 'center',
            }}
          >
            A4 paper (Auto-rotate)
          </button>
        </div>
      </div>

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
        <span>
          Page margins
          <small>Padding around each photo</small>
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', width: '100%' }}>
          {(['none', 'small', 'standard'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              className="cta"
              onClick={() => setMargin(preset)}
              style={{
                background: margin === preset ? 'var(--text)' : 'var(--surface-2)',
                color: margin === preset ? 'var(--background)' : 'var(--text)',
                border: '1px solid var(--border)',
                padding: '6px 10px',
                fontSize: '12px',
                textTransform: 'capitalize',
                fontWeight: 500,
                justifyContent: 'center',
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Existing Tool Definition Options (e.g. shrink) */}
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
            {pageSizing === 'fit'
              ? `Creating ${fileCount} ${fileCount === 1 ? 'page' : 'pages'} sized to each photo's natural proportions. Each image corresponds directly to Page 1 through Page ${fileCount} in the output PDF.`
              : `Creating ${fileCount} A4 ${fileCount === 1 ? 'page' : 'pages'} with auto-orientation (portrait or landscape). Each image corresponds directly to Page 1 through Page ${fileCount} in the output PDF.`}
          </span>
        </div>
      )}

      <div style={{ marginTop: '10px', marginBottom: '4px' }}>
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
        style={{ marginTop: '14px' }}
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
