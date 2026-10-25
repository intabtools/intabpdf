import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { pdfProcessingService } from '../../core';

export default function RemovePagesTool({
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
  const [removePagesInput, setRemovePagesInput] = useState('1');

  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const handleRun = async () => {
    await onExecute(async () => {
      const indices = removePagesInput
        .split(/[,\s]+/)
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((n) => !isNaN(n) && n >= 0);

      return await pdfProcessingService.execute('remove-pages', {
        buffer: stagedFiles[0].bytes,
        pageIndices: indices.length > 0 ? indices : [0],
      });
    });
  };

  return (
    <div className="card opts">
      <div
        className="sw"
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '6px',
        }}
      >
        <span>
          Page numbers to remove
          <small>Comma-separated (e.g. 1, 3)</small>
        </span>
        <input
          type="text"
          value={removePagesInput}
          onChange={(e) => setRemovePagesInput(e.target.value)}
          placeholder="e.g. 1, 3"
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
          }}
        />
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

      <div style={{ marginTop: '6px', marginBottom: '8px' }}>
        <OutputFilenameInput
          value={outputBaseName ?? ''}
          onChange={onOutputBaseNameChange ?? (() => {})}
          placeholder={defaultBaseName ?? 'edited-document'}
          extension={outputExtension ?? '.pdf'}
        />
      </div>

      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={isProcessing || stagedFiles.length === 0}
      >
        <Trash2 size={16} />
        <span>
          {isProcessing ? 'Removing...' : 'Remove pages from file'}
        </span>
      </button>
    </div>
  );
}
