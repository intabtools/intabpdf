import type { ReactNode } from 'react';

interface StatusBarProps {
  onSwitchToWeb?: () => void;
}

export default function StatusBar({ onSwitchToWeb }: StatusBarProps): ReactNode {
  return (
    <footer className="stb" aria-label="Status bar">
      <span>MIT</span>
      <span>v1.0.0</span>
      {onSwitchToWeb && (
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
