// Tool module for extracting plain text from a PDF document.
import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { extractTextFromPdf } from '../../core';

export default function ExtractTextTool({
  tool,
  stagedFiles,
  optionsState,
  onOptionsChange,
  onExecute,
  isProcessing,
  onExtraStateChange,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const handleRun = async () => {
    if (stagedFiles.length === 0) return;

    await onExecute(async () => {
      const keepLineBreaks = optionsState['line-breaks'] ?? true;
      const res = await extractTextFromPdf(stagedFiles[0].bytes, { keepLineBreaks });
      onExtraStateChange?.('hasImages', res.hasImages ?? false);
      onExtraStateChange?.('wordCount', res.wordCount);
      onExtraStateChange?.('isScanned', Boolean(res.hasImages && res.wordCount === 0));
      return new TextEncoder().encode(res.text);
    });
  };

  return (
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
          placeholder={defaultBaseName ?? 'extracted-text'}
          extension={outputExtension ?? '.txt'}
        />
      </div>

      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={isProcessing || stagedFiles.length === 0}
      >
        <FileText size={16} style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0, textAlign: 'center', lineHeight: 1.3 }}>
          {isProcessing ? 'Extracting text…' : 'Extract text from file'}
        </span>
      </button>
    </div>
  );
}
