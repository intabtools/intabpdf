// Bottom desktop status bar displaying license, dynamic application version, and shortcuts.
import type { ReactNode } from 'react';
import { APP_VERSION } from '../config';

interface StatusBarProps {
  onSwitchToWeb?: () => void;
}

export default function StatusBar({ onSwitchToWeb }: StatusBarProps): ReactNode {
  return (
    <footer className="stb" aria-label="Status bar">
      <span>MIT</span>
      <span>v{APP_VERSION}</span>
      {Boolean(import.meta.env.DEV) && onSwitchToWeb && (
        <button
          type="button"
          onClick={onSwitchToWeb}
          style={{ opacity: 0.85, color: 'var(--accent)', cursor: 'pointer', fontSize: '11px', background: 'none', border: 0, padding: 0 }}
          title="Switch to Website view"
        >
          Website view
        </button>
      )}
      <span className="sp" />
      <span>Ctrl K to search</span>
    </footer>
  );
}
