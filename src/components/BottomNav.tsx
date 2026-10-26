import type { ReactNode } from 'react';
import { Eye, Info, LayoutGrid } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export default function BottomNav(): ReactNode {
  const location = useLocation();

  const isToolsActive = location.pathname === '/' || location.pathname.startsWith('/tool/');
  const isViewerActive = location.pathname.startsWith('/viewer');
  const isAboutActive = location.pathname === '/about';

  return (
    <nav className="vt" aria-label="Bottom navigation bar">
      <Link
        to="/"
        className={isToolsActive ? 'on' : ''}
        aria-current={isToolsActive ? 'page' : undefined}
      >
        <LayoutGrid size={22} strokeWidth={1.8} />
        <span>Tools</span>
      </Link>

      <Link
        to="/viewer"
        className={isViewerActive ? 'on' : ''}
        aria-current={isViewerActive ? 'page' : undefined}
      >
        <Eye size={22} strokeWidth={1.8} />
        <span>Viewer</span>
      </Link>

      <Link
        to="/about"
        className={isAboutActive ? 'on' : ''}
        aria-current={isAboutActive ? 'page' : undefined}
      >
        <Info size={22} strokeWidth={1.8} />
        <span>About</span>
      </Link>
    </nav>
  );
}
