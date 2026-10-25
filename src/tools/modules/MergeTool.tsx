import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { pdfProcessingService } from '../../core';

export default function MergeTool({
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
  const toggleOption = (id: string) => {
    onOptionsChange({
      ...optionsState,
      [id]: !optionsState[id],
    });
  };

  const handleRun = async () => {
    await onExecute(async () => {
      return await pdfProcessingService.execute('merge', {
        buffers: stagedFiles.map((f) => f.bytes),
      });
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

      <div style={{ marginTop: '6px', marginBottom: '8px' }}>
        <OutputFilenameInput
          value={outputBaseName ?? ''}
          onChange={onOutputBaseNameChange ?? (() => {})}
          placeholder={defaultBaseName ?? 'merged-document'}
          extension={outputExtension ?? '.pdf'}
        />
      </div>

      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={isProcessing || stagedFiles.length === 0}
      >
        <Layers size={16} />
        <span>
          {isProcessing ? 'Merging...' : `Merge ${stagedFiles.length} files`}
        </span>
      </button>
    </div>
  );
}
