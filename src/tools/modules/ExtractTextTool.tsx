// Tool module for extracting plain text from a PDF document.
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import { ProcessingContext } from '../../components/processingContextDef';
import type { ToolComponentProps } from '../types';
import { extractTextFromPdf } from '../../core';
import { executeBatchOperation } from '../batchOperation';
import { getCleanBaseName } from '../filename';

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
  const processing = useContext(ProcessingContext);

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const handleRun = async () => {
    if (stagedFiles.length === 0) return;

    const isMultiFile = stagedFiles.length > 1;
    const abortController = isMultiFile ? new AbortController() : null;
    if (abortController) {
      processing?.setCancelHandler?.(() => {
        abortController.abort();
      });
    }

    try {
      await onExecute(async () => {
        const keepLineBreaks = optionsState['line-breaks'] ?? true;

        if (stagedFiles.length === 1) {
          const res = await extractTextFromPdf(stagedFiles[0].bytes, { keepLineBreaks });
          onExtraStateChange?.('hasImages', res.hasImages ?? false);
          onExtraStateChange?.('wordCount', res.wordCount);
          onExtraStateChange?.('isScanned', Boolean(res.hasImages && res.wordCount === 0));
          return new TextEncoder().encode(res.text);
        }

        let totalWordCount = 0;
        let hasAnyImages = false;

        const zipBytes = await executeBatchOperation({
          actionVerb: 'Extracting text',
          stagedFiles,
          updateMessage: processing?.updateMessage,
          onExtraStateChange,
          signal: abortController?.signal,
          processFile: async (curFile) => {
            const res = await extractTextFromPdf(curFile.bytes, { keepLineBreaks });
            totalWordCount += res.wordCount;
            if (res.hasImages) hasAnyImages = true;

            const cleanBase = getCleanBaseName(curFile.name) || 'document';
            return {
              name: `${cleanBase}.txt`,
              bytes: new TextEncoder().encode(res.text),
            };
          },
        });

        onExtraStateChange?.('hasImages', hasAnyImages);
        onExtraStateChange?.('wordCount', totalWordCount);
        return zipBytes;
      });
    } finally {
      if (isMultiFile) {
        processing?.setCancelHandler?.(null);
      }
    }
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
        {stagedFiles.length > 1 && (
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
        )}
      </div>

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
          placeholder={defaultBaseName ?? (stagedFiles.length > 1 ? 'extracted-texts' : 'extracted-text')}
          extension={outputExtension ?? (stagedFiles.length > 1 ? '.zip' : '.txt')}
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
          {isProcessing
            ? stagedFiles.length > 1
              ? `Extracting text (${stagedFiles.length} files)...`
              : 'Extracting text…'
            : stagedFiles.length > 1
            ? `Extract text from ${stagedFiles.length} files`
            : 'Extract text from file'}
        </span>
      </button>
    </div>
  );
}
