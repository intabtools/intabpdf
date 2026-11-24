// Tool module for converting plain text or .txt files into styled PDF documents.
import { useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { AlertCircle, FileText, RotateCcw, Upload } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import type {
  TextFontFamily,
  TextMarginPreset,
  TextOrientation,
  TextPageSize,
  TextToPdfOptions,
} from '../../core/text-to-pdf';
import { pdfProcessingService } from '../../core/worker/service';

// Standard 218 WinAnsi character code points supported by standard PDF fonts
const WIN_ANSI_CODE_POINTS = new Set([
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
  64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
  80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95,
  96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
  110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122,
  123, 124, 125, 126, 160, 161, 162, 163, 164, 165, 166, 167, 168,
  169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181,
  182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194,
  195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207,
  208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220,
  221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233,
  234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246,
  247, 248, 249, 250, 251, 252, 253, 254, 255, 402, 710, 732, 8211,
  8212, 8216, 8217, 8218, 8220, 8221, 8222, 8224, 8225, 8226, 8230,
  8240, 8249, 8250, 8364, 8482,
]);

const MAX_CHARACTER_LIMIT = 200_000;

export default function TextToPdfTool({
  stagedFiles,
  optionsState,
  onExecute,
  isProcessing,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const [prevFileId, setPrevFileId] = useState<string | undefined>(stagedFiles[0]?.id);
  const [text, setText] = useState<string>(() => {
    if (stagedFiles && stagedFiles.length > 0 && stagedFiles[0]?.bytes) {
      try {
        return new TextDecoder('utf-8').decode(stagedFiles[0].bytes);
      } catch {
        return '';
      }
    }
    return '';
  });

  if (stagedFiles[0]?.id !== prevFileId) {
    setPrevFileId(stagedFiles[0]?.id);
    if (stagedFiles[0]?.bytes) {
      try {
        const decoded = new TextDecoder('utf-8').decode(stagedFiles[0].bytes);
        setText(decoded);
        if (onOutputBaseNameChange && stagedFiles[0].name) {
          const cleanName = stagedFiles[0].name.replace(/\.[^/.]+$/, '');
          onOutputBaseNameChange(cleanName);
        }
      } catch (err) {
        console.error('Failed to decode staged text file:', err);
      }
    }
  }

  const [pageSize, setPageSize] = useState<TextPageSize>('a4');
  const [orientation, setOrientation] = useState<TextOrientation>('portrait');
  const [marginPreset, setMarginPreset] = useState<TextMarginPreset>('normal');
  const [fontFamily, setFontFamily] = useState<TextFontFamily>(() =>
    optionsState['mono'] ? 'courier' : 'helvetica'
  );
  const [fontSize, setFontSize] = useState<number>(11);
  const [lineSpacing, setLineSpacing] = useState<number>(1.3);
  const [includePageNumbers, setIncludePageNumbers] = useState<boolean>(() =>
    optionsState['page-nums'] !== undefined ? optionsState['page-nums'] : true
  );
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Character and word counts
  const charCount = text.length;
  const wordCount = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const matches = trimmed.match(/\S+/g);
    return matches ? matches.length : 0;
  }, [text]);

  const isOverLimit = charCount > MAX_CHARACTER_LIMIT;

  // Pre-flight validation of unsupported characters
  const unsupportedChars = useMemo(() => {
    if (!text) return [];
    const unsupp: { char: string; line: number }[] = [];
    const lines = text.split(/\r\n|\r|\n/);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineText = lines[lineIdx];
      for (const char of lineText) {
        const cp = char.codePointAt(0);
        if (cp !== undefined && !WIN_ANSI_CODE_POINTS.has(cp)) {
          unsupp.push({ char, line: lineIdx + 1 });
        }
      }
    }
    return unsupp;
  }, [text]);

  const uniqueUnsupported = useMemo(() => {
    const seen = new Set<string>();
    const list: { char: string; lines: number[] }[] = [];
    for (const item of unsupportedChars) {
      if (!seen.has(item.char)) {
        seen.add(item.char);
        const lines = unsupportedChars
          .filter((u) => u.char === item.char)
          .map((u) => u.line);
        list.push({ char: item.char, lines: Array.from(new Set(lines)).slice(0, 3) });
      }
    }
    return list.slice(0, 6);
  }, [unsupportedChars]);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result;
      if (typeof content === 'string') {
        setText(content);
        if (onOutputBaseNameChange) {
          const cleanName = file.name.replace(/\.[^/.]+$/, '');
          onOutputBaseNameChange(cleanName);
        }
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result;
        if (typeof content === 'string') {
          setText(content);
          if (onOutputBaseNameChange) {
            const cleanName = file.name.replace(/\.[^/.]+$/, '');
            onOutputBaseNameChange(cleanName);
          }
        }
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  const handleExecute = async () => {
    if (
      isProcessing ||
      text.trim().length === 0 ||
      isOverLimit ||
      unsupportedChars.length > 0
    ) {
      return;
    }

    const payloadOptions: TextToPdfOptions = {
      pageSize,
      orientation,
      marginPreset,
      fontFamily,
      fontSize,
      lineSpacing,
      includePageNumbers,
    };

    await onExecute(async (signal) => {
      return await pdfProcessingService.execute(
        'text-to-pdf',
        {
          text,
          options: payloadOptions,
        },
        { signal }
      );
    });
  };

  return (
    <>
      {/* Left Column: Text Editor Workspace */}
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
            <FileText size={18} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Text Content</h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <button
              type="button"
              className="btn btn-secondary sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={13} />
              Open .txt file
            </button>

            {text.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary sm"
                onClick={() => setText('')}
                title="Clear all text"
                aria-label="Clear all text"
              >
                <RotateCcw size={13} />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Textarea Editor with explicit user-select: text */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          placeholder="Type or paste your text here, or open a local .txt file..."
          rows={16}
          style={{
            width: '100%',
            minHeight: '340px',
            padding: '12px',
            fontSize: '13px',
            lineHeight: 1.5,
            fontFamily:
              fontFamily === 'courier'
                ? 'var(--font-mono, monospace)'
                : fontFamily === 'times'
                ? 'var(--font-serif, serif)'
                : 'var(--font-sans, sans-serif)',
            borderRadius: 'var(--radius-md)',
            border: isDragOver
              ? '2px dashed var(--accent)'
              : '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            resize: 'vertical',
            userSelect: 'text',
            WebkitUserSelect: 'text',
          }}
        />

        {/* Character & Word Counter */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: isOverLimit ? 'var(--error, #e53e3e)' : 'var(--text-muted)',
          }}
        >
          <span>
            {charCount.toLocaleString()} / {MAX_CHARACTER_LIMIT.toLocaleString()} characters ({wordCount.toLocaleString()} words)
          </span>
          {isOverLimit && (
            <span style={{ fontWeight: 600 }}>Character limit exceeded</span>
          )}
        </div>

        {/* Unsupported Characters Banner */}
        {uniqueUnsupported.length > 0 && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--warning-surface, #fffaf0)',
              border: '1px solid var(--warning-border, #feebc8)',
              color: 'var(--warning-text, #744210)',
              fontSize: '12px',
              lineHeight: 1.5,
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Unsupported characters detected:</strong>{' '}
              {uniqueUnsupported.map((u, idx) => (
                <span key={idx} style={{ marginRight: '8px' }}>
                  <code>{u.char}</code> (lines {u.lines.join(', ')})
                </span>
              ))}
              <div style={{ marginTop: '4px' }}>
                Standard PDF fonts only support Western European characters (Windows-1252). Please remove these characters to proceed.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Styling & Page Options */}
      <div className="card opts">
        {/* Page Size */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Page Size
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['a4', 'letter', 'legal'] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                className={`btn btn-secondary ${pageSize === sz ? 'active' : ''}`}
                style={{
                  flex: 1,
                  fontSize: '12px',
                  padding: '6px',
                  fontWeight: pageSize === sz ? 600 : 400,
                  background: pageSize === sz ? 'var(--accent)' : undefined,
                  color: pageSize === sz ? '#fff' : undefined,
                }}
                onClick={() => setPageSize(sz)}
              >
                {sz.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Orientation */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Orientation
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['portrait', 'landscape'] as const).map((o) => (
              <button
                key={o}
                type="button"
                className={`btn btn-secondary ${orientation === o ? 'active' : ''}`}
                style={{
                  flex: 1,
                  fontSize: '12px',
                  padding: '6px',
                  textTransform: 'capitalize',
                  fontWeight: orientation === o ? 600 : 400,
                  background: orientation === o ? 'var(--accent)' : undefined,
                  color: orientation === o ? '#fff' : undefined,
                }}
                onClick={() => setOrientation(o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>

        {/* Margins */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Margins
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['compact', 'normal', 'spacious'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn btn-secondary ${marginPreset === m ? 'active' : ''}`}
                style={{
                  flex: 1,
                  fontSize: '12px',
                  padding: '6px',
                  textTransform: 'capitalize',
                  fontWeight: marginPreset === m ? 600 : 400,
                  background: marginPreset === m ? 'var(--accent)' : undefined,
                  color: marginPreset === m ? '#fff' : undefined,
                }}
                onClick={() => setMarginPreset(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Font Family */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Font
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['helvetica', 'times', 'courier'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`btn btn-secondary ${fontFamily === f ? 'active' : ''}`}
                style={{
                  flex: 1,
                  fontSize: '12px',
                  padding: '6px',
                  textTransform: 'capitalize',
                  fontWeight: fontFamily === f ? 600 : 400,
                  background: fontFamily === f ? 'var(--accent)' : undefined,
                  color: fontFamily === f ? '#fff' : undefined,
                }}
                onClick={() => setFontFamily(f)}
              >
                {f === 'helvetica' ? 'Sans' : f === 'times' ? 'Serif' : 'Mono'}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size & Line Spacing */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Size (pt)
            </label>
            <select
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
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
              {[9, 10, 11, 12, 14, 16, 18].map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Spacing
            </label>
            <select
              value={lineSpacing}
              onChange={(e) => setLineSpacing(Number(e.target.value))}
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
              <option value={1.15}>1.15 (Tight)</option>
              <option value={1.3}>1.3 (Normal)</option>
              <option value={1.5}>1.5 (Relaxed)</option>
              <option value={2.0}>2.0 (Double)</option>
            </select>
          </div>
        </div>

        {/* Add Page Numbers Switch */}
        <div className="sw" style={{ marginTop: '4px' }}>
          <span>
            Page numbers
            <small>Centered at bottom of each page</small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={includePageNumbers}
            aria-label="Add page numbers"
            className={`tg ${includePageNumbers ? 'on' : ''}`}
            onClick={() => setIncludePageNumbers(!includePageNumbers)}
          />
        </div>

        {/* Output filename input */}
        <div style={{ marginTop: '4px', marginBottom: '4px' }}>
          <OutputFilenameInput
            value={outputBaseName ?? ''}
            onChange={onOutputBaseNameChange ?? (() => {})}
            placeholder={defaultBaseName ?? 'document'}
            extension={outputExtension ?? '.pdf'}
          />
        </div>

        {/* CTA Action Button */}
        <button
          type="button"
          className="cta"
          onClick={handleExecute}
          disabled={
            isProcessing ||
            text.trim().length === 0 ||
            isOverLimit ||
            unsupportedChars.length > 0
          }
          style={{ marginTop: '8px' }}
        >
          <FileText size={16} style={{ flexShrink: 0 }} />
          <span>{isProcessing ? 'Creating PDF...' : 'Create PDF'}</span>
        </button>
      </div>
    </>
  );
}
