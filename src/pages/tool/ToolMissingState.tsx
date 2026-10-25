// Fallback screens for non-existent tools or tools that are marked coming soon.
import type { ReactNode } from 'react';
import ToolIcon from '../../components/ToolIcon';
import type { ToolDefinition } from '../../tools/types';

export interface ToolMissingStateProps {
  tool?: ToolDefinition;
  onNavigateHome: () => void;
}

export default function ToolMissingState({
  tool,
  onNavigateHome,
}: ToolMissingStateProps): ReactNode {
  if (!tool) {
    return (
      <div className="cnt">
        <div className="card busy">
          <b>Tool not found</b>
          <p className="lede">The requested tool does not exist.</p>
          <button type="button" className="cta" onClick={onNavigateHome}>
            Back to All Tools
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cnt">
      <div className="card busy" style={{ textAlign: 'center', padding: '36px 20px' }}>
        <ToolIcon name={tool.icon} size={36} />
        <b style={{ fontSize: '18px', marginTop: '12px' }}>{tool.name}</b>
        <p className="lede" style={{ margin: '8px 0 20px' }}>
          This tool is coming soon.
        </p>
        <button type="button" className="cta" onClick={onNavigateHome}>
          Back to All Tools
        </button>
      </div>
    </div>
  );
}
