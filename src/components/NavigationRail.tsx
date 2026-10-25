import type { ReactNode } from 'react';
import { Code2, Eye, Info, LayoutGrid, Plus } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useViewer } from '../hooks/useViewer';

export default function NavigationRail(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { openPdfPicker } = useViewer();

  const handleOpenPdf = async () => {
    const file = await openPdfPicker();
    if (file) {
      navigate('/viewer');
    }
  };

  const isToolsActive = location.pathname === '/' || location.pathname.startsWith('/tool/');
  const isViewerActive = location.pathname.startsWith('/viewer');
  const isAboutActive = location.pathname === '/about';

  return (
    <nav className="rail" aria-label="Main navigation rail">
      <button
        type="button"
        className="sq"
        onClick={() => void handleOpenPdf()}
        aria-label="Open PDF"
        title="Open PDF"
      >
        <Plus size={20} strokeWidth={2.2} />
      </button>

      <Link
        to="/"
        className={`ri ${isToolsActive ? 'on' : ''}`}
        aria-label="Tools catalog"
      >
        <LayoutGrid size={22} strokeWidth={1.8} />
        <span>Tools</span>
      </Link>

      <Link
        to="/viewer"
        className={`ri ${isViewerActive ? 'on' : ''}`}
        aria-label="PDF Viewer"
      >
        <Eye size={22} strokeWidth={1.8} />
        <span>Viewer</span>
      </Link>

      <Link
        to="/about"
        className={`ri ${isAboutActive ? 'on' : ''}`}
        aria-label="About"
      >
        <Info size={22} strokeWidth={1.8} />
        <span>About</span>
      </Link>

      <i className="sp" />

      <a
        href="https://github.com/intabtools/intabpdf"
        target="_blank"
        rel="noopener noreferrer"
        className="ri"
        aria-label="Source code on GitHub"
      >
        <Code2 size={22} strokeWidth={1.8} />
        <span>Source</span>
      </a>
    </nav>
  );
}
