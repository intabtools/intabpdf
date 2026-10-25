// Web shell layout wrapper for ToolPage including breadcrumb navigation and catalog footer links.
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ToolIcon from '../../components/ToolIcon';
import { isToolImplemented } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/types';

export interface ToolWebLayoutProps {
  toolName: string;
  children: ReactNode;
  otherTools: ToolDefinition[];
  onComingSoonClick: (e: ReactMouseEvent) => void;
}

export default function ToolWebLayout({
  toolName,
  children,
  otherTools,
  onComingSoonClick,
}: ToolWebLayoutProps): ReactNode {
  return (
    <div className="wp">
      <nav className="bc" aria-label="Breadcrumb">
        <Link to="/">All tools</Link>
        <span aria-hidden="true">/</span>
        <b>{toolName}</b>
      </nav>
      <h1 className="wh1">{toolName}</h1>
      {children}
      <h2 className="wgl" style={{ marginTop: '44px' }}>More tools</h2>
      <div className="chips">
        {otherTools.map((t) => (
          <Link
            key={t.id}
            to={`/tool/${t.id}`}
            onClick={(e) => {
              if (!isToolImplemented(t.id)) {
                onComingSoonClick(e);
              }
            }}
            className="chip"
          >
            <ToolIcon name={t.icon} size={16} />
            <span>{t.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
