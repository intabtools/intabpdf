import type { ReactNode } from 'react';
import { ChevronLeft, Menu, Moon, Search, Sun } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Logo from './Logo';

interface AppHeaderProps {
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  subTitle?: string;
  isSidebarCollapsed: boolean;
  isDrawerOpen: boolean;
}

export default function AppHeader({
  onToggleSidebar,
  onOpenPalette,
  isDark,
  onToggleTheme,
  subTitle,
  isSidebarCollapsed,
  isDrawerOpen,
}: AppHeaderProps): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const isSubPage = location.pathname !== '/';

  return (
    <header className={`hdr ${isSubPage ? 'sub' : ''}`}>
      <button
        type="button"
        className="ib mn"
        onClick={onToggleSidebar}
        aria-label={
          isDrawerOpen
            ? 'Close menu'
            : isSidebarCollapsed
              ? 'Expand sidebar'
              : 'Collapse sidebar'
        }
        title={
          isSidebarCollapsed
            ? 'Expand sidebar (Ctrl B)'
            : 'Collapse sidebar (Ctrl B)'
        }
        aria-controls="drawer"
      >
        <Menu size={24} strokeWidth={1.8} />
      </button>

      {isSubPage && (
        <button
          type="button"
          className="ib bk"
          onClick={() => navigate(-1)}
          aria-label="Back to previous page"
        >
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
      )}

      <div className="t1">
        <Link to="/" className="hb" aria-label="InTab PDF home">
          <Logo size={26} />
          <b>InTab</b>
          <em>PDF</em>
        </Link>
        {subTitle && <span className="hc">{subTitle}</span>}
      </div>

      <button
        type="button"
        className="hs"
        onClick={onOpenPalette}
        aria-label="Search tools (Ctrl+K)"
      >
        <Search size={16} strokeWidth={1.8} />
        <span>Search tools</span>
        <kbd>Ctrl K</kbd>
      </button>

      <button
        type="button"
        className="ib hsi"
        onClick={onOpenPalette}
        aria-label="Search tools"
      >
        <Search size={22} strokeWidth={1.8} />
      </button>

      <button
        type="button"
        className="ib"
        onClick={onToggleTheme}
        aria-label="Toggle theme"
        title="Toggle light/dark theme"
      >
        {isDark ? <Sun size={24} strokeWidth={1.8} /> : <Moon size={24} strokeWidth={1.8} />}
      </button>
    </header>
  );
}
