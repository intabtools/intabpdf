import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import { Code2, Eye, Info, LayoutGrid, Plus, X } from 'lucide-react';
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

function getFullToolLabel(name: string): string {
  if (name === 'Merge') return 'Merge PDFs';
  if (name === 'Compress') return 'Compress PDF';
  if (name === 'Split') return 'Split PDF';
  if (name === 'Sign') return 'Sign PDF';
  if (name === 'Protect') return 'Protect PDF';
  if (name === 'Unlock') return 'Unlock PDF';
  return name;
}

export default function Sidebar({ onCloseDrawer, isCollapsed }: SidebarProps): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { openPdfPicker } = useViewer();
  const { showToast } = useToast();

  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTooltipShow = (
    e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
    label: string
  ) => {
    if (!isCollapsed) return;
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    const target = e.currentTarget;
    tooltipTimeoutRef.current = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const top = Math.max(16, Math.min(window.innerHeight - 30, rect.top + rect.height / 2));
      setTooltip({
        label,
        top,
        left: rect.right + 12,
      });
    }, 150);
  };

  const handleTooltipHide = () => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setTooltip(null);
  };

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

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

  const handleSourceCodeClick = (e: MouseEvent<HTMLAnchorElement>) => {
    handleNavClick();
    if (typeof window !== 'undefined' && window.intab?.openExternalUrl) {
      e.preventDefault();
      window.intab.openExternalUrl('https://github.com/intabtools/intabpdf');
    }
  };

  const isHomeActive = location.pathname === '/';
  const isViewerActive = location.pathname.startsWith('/viewer');
  const isAboutActive = location.pathname === '/about';

  return (
    <>
      <div className="scr" onClick={onCloseDrawer} aria-hidden="true" />
      <aside className="sb" id="drawer" aria-label="Main menu">
        <div className="sbl">
          <div className="sbl-brand">
            <Logo size={36} />
            <div>
              <b>InTab PDF</b>
              <small>PDF tools</small>
            </div>
          </div>
          <button
            type="button"
            className="ib sm sbc"
            onClick={onCloseDrawer}
            aria-label="Close menu"
            title="Close menu"
          >
            <X size={20} strokeWidth={1.8} />
          </button>
        </div>

        <div className="sbg">
          <button
            type="button"
            className="sbo"
            onClick={() => void handleOpenPdf()}
            onMouseEnter={(e) => handleTooltipShow(e, 'Open PDF')}
            onMouseLeave={handleTooltipHide}
            onFocus={(e) => handleTooltipShow(e, 'Open PDF')}
            onBlur={handleTooltipHide}
            title={isCollapsed ? 'Open PDF' : undefined}
            aria-label="Open PDF"
          >
            <Plus size={20} strokeWidth={2.2} />
            <span>Open PDF</span>
          </button>

          <Link
            to="/"
            className={`si ${isHomeActive ? 'on' : ''}`}
            onClick={handleNavClick}
            onMouseEnter={(e) => handleTooltipShow(e, 'All tools')}
            onMouseLeave={handleTooltipHide}
            onFocus={(e) => handleTooltipShow(e, 'All tools')}
            onBlur={handleTooltipHide}
            title={isCollapsed ? 'All tools' : undefined}
            aria-label="All tools"
          >
            <LayoutGrid size={22} strokeWidth={1.8} />
            <span>All tools</span>
          </Link>

          <Link
            to="/viewer"
            className={`si ${isViewerActive ? 'on' : ''}`}
            onClick={handleNavClick}
            onMouseEnter={(e) => handleTooltipShow(e, 'PDF Viewer')}
            onMouseLeave={handleTooltipHide}
            onFocus={(e) => handleTooltipShow(e, 'PDF Viewer')}
            onBlur={handleTooltipHide}
            title={isCollapsed ? 'PDF Viewer' : undefined}
            aria-label="PDF Viewer"
          >
            <Eye size={22} strokeWidth={1.8} />
            <span>Viewer</span>
          </Link>

          {TOOL_CATEGORIES.map((category) => {
            const categoryTools = getToolsByCategory(category);
            return (
              <div key={category}>
                <div className="sbt">{category}</div>
                {categoryTools.map((tool) => {
                  const isToolActive = location.pathname === `/tool/${tool.id}`;
                  const fullLabel = getFullToolLabel(tool.name);
                  return (
                    <Link
                      key={tool.id}
                      to={`/tool/${tool.id}`}
                      className={`si ${isToolActive ? 'on' : ''}`}
                      onClick={() => {
                        handleNavClick();
                        if (!isToolImplemented(tool.id)) {
                          showToast('Coming soon: tool is under development');
                        }
                      }}
                      onMouseEnter={(e) => handleTooltipShow(e, fullLabel)}
                      onMouseLeave={handleTooltipHide}
                      onFocus={(e) => handleTooltipShow(e, fullLabel)}
                      onBlur={handleTooltipHide}
                      title={isCollapsed ? fullLabel : undefined}
                      aria-label={fullLabel}
                    >
                      <ToolIcon name={tool.icon} size={22} />
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
              onMouseEnter={(e) => handleTooltipShow(e, 'About InTab PDF')}
              onMouseLeave={handleTooltipHide}
              onFocus={(e) => handleTooltipShow(e, 'About InTab PDF')}
              onBlur={handleTooltipHide}
              title={isCollapsed ? 'About InTab PDF' : undefined}
              aria-label="About InTab PDF"
            >
              <Info size={22} strokeWidth={1.8} />
              <span>About</span>
            </Link>

            <a
              href="https://github.com/intabtools/intabpdf"
              target="_blank"
              rel="noopener noreferrer"
              className="si"
              onClick={handleSourceCodeClick}
              onMouseEnter={(e) => handleTooltipShow(e, 'Source code (GitHub)')}
              onMouseLeave={handleTooltipHide}
              onFocus={(e) => handleTooltipShow(e, 'Source code (GitHub)')}
              onBlur={handleTooltipHide}
              title={isCollapsed ? 'Source code (GitHub)' : undefined}
              aria-label="Source code (GitHub)"
            >
              <Code2 size={22} strokeWidth={1.8} />
              <span>Source code</span>
            </a>
          </div>
        </div>
      </aside>

      {isCollapsed && tooltip && (
        <div
          className="sb-tooltip"
          style={{
            position: 'fixed',
            top: `${tooltip.top}px`,
            left: `${tooltip.left}px`,
            transform: 'translateY(-50%)',
          }}
          role="tooltip"
          aria-hidden="true"
        >
          {tooltip.label}
        </div>
      )}
    </>
  );
}
