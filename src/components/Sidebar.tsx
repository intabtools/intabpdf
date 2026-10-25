import type { ReactNode } from 'react';
import { Code2, Eye, Info, LayoutGrid, Plus } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { TOOL_CATEGORIES, getToolsByCategory, isToolImplemented } from '../tools/registry';
import { useViewer } from '../hooks/useViewer';
import { useToast } from '../hooks/useToast';
import Logo from './Logo';
import ToolIcon from './ToolIcon';

interface SidebarProps {
  onCloseDrawer: () => void;
  isCollapsed: boolean;
}

export default function Sidebar({ onCloseDrawer, isCollapsed }: SidebarProps): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { openPdfPicker } = useViewer();
  const { showToast } = useToast();

  const handleOpenPdf = async () => {
    onCloseDrawer();
    const file = await openPdfPicker();
    if (file) {
      navigate('/viewer');
    }
  };

  const handleNavClick = () => {
    onCloseDrawer();
  };

  const isHomeActive = location.pathname === '/';
  const isViewerActive = location.pathname.startsWith('/viewer');
  const isAboutActive = location.pathname === '/about';

  return (
    <>
      <div className="scr" onClick={onCloseDrawer} aria-hidden="true" />
      <aside className="sb" id="drawer" aria-label="Main menu">
        <div className="sbl">
          <Logo size={36} />
          <div>
            <b>InTab PDF</b>
            <small>PDF tools</small>
          </div>
        </div>

        <div className="sbg">
          <button
            type="button"
            className="sbo"
            onClick={() => void handleOpenPdf()}
            title={isCollapsed ? 'Open PDF' : undefined}
            aria-label="Open PDF"
          >
            <Plus size={16} strokeWidth={2.2} />
            <span>Open PDF</span>
          </button>

          <Link
            to="/"
            className={`si ${isHomeActive ? 'on' : ''}`}
            onClick={handleNavClick}
            title={isCollapsed ? 'All tools' : undefined}
            aria-label="All tools"
          >
            <LayoutGrid size={20} strokeWidth={1.8} />
            <span>All tools</span>
          </Link>

          <Link
            to="/viewer"
            className={`si ${isViewerActive ? 'on' : ''}`}
            onClick={handleNavClick}
            title={isCollapsed ? 'Viewer' : undefined}
            aria-label="Viewer"
          >
            <Eye size={20} strokeWidth={1.8} />
            <span>Viewer</span>
          </Link>

          {TOOL_CATEGORIES.map((category) => {
            const categoryTools = getToolsByCategory(category);
            return (
              <div key={category}>
                <div className="sbt">{category}</div>
                {categoryTools.map((tool) => {
                  const isToolActive = location.pathname === `/tool/${tool.id}`;
                  return (
                    <Link
                      key={tool.id}
                      to={`/tool/${tool.id}`}
                      className={`si ${isToolActive ? 'on' : ''}`}
                      onClick={() => {
                        handleNavClick();
                        if (!isToolImplemented(tool.id)) {
                          showToast('Coming soon — tool is under development');
                        }
                      }}
                      title={isCollapsed ? tool.name : undefined}
                      aria-label={tool.name}
                    >
                      <ToolIcon name={tool.icon} size={20} />
                      <span>{tool.name}</span>
                      {tool.availability === 'coming-soon' && !isCollapsed && (
                        <span className="badge-cs">Soon</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}

          <div className="sbf">
            <Link
              to="/about"
              className={`si ${isAboutActive ? 'on' : ''}`}
              onClick={handleNavClick}
              title={isCollapsed ? 'About' : undefined}
              aria-label="About"
            >
              <Info size={20} strokeWidth={1.8} />
              <span>About</span>
            </Link>

            <a
              href="https://github.com/intabtools/intabpdf"
              target="_blank"
              rel="noopener noreferrer"
              className="si"
              onClick={handleNavClick}
              title={isCollapsed ? 'Source code' : undefined}
              aria-label="Source code"
            >
              <Code2 size={20} strokeWidth={1.8} />
              <span>Source code</span>
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
