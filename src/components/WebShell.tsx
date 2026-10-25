// Web layout shell for standalone browser usage with sticky navigation header, breadcrumbs, and footer.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Moon, Search, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import CommandPalette from './CommandPalette';
import Logo from './Logo';
import { useShell } from '../hooks/useShell';
import { APP_VERSION } from '../config';

interface WebShellProps {
  children: ReactNode;
  onSwitchToApp?: () => void;
  onSwitchToDesktop?: () => void;
  showAppLayout?: boolean;
}

export default function WebShell({
  children,
  onSwitchToApp,
  onSwitchToDesktop,
  showAppLayout = true,
}: WebShellProps): ReactNode {
  const location = useLocation();
  const { setShowAppLayout } = useShell();

  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('intab.theme');
      if (saved) return saved === 'dark';
    } catch {
      // Ignore
    }
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  });

  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    try {
      localStorage.setItem('intab.theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore
    }
  }, [isDark]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        if (!showAppLayout) {
          setShowAppLayout(true);
        } else if (isPaletteOpen) {
          setIsPaletteOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaletteOpen, showAppLayout, setShowAppLayout]);

  const isHomeActive = location.pathname === '/' || location.pathname.startsWith('/tool/');
  const isAboutActive = location.pathname === '/about';

  if (!showAppLayout) {
    return (
      <div className="app web full-bleed" style={{ height: '100%', overflow: 'hidden' }}>
        {children}
      </div>
    );
  }

  return (
    <div className="app web">
      <div className="wscroll" id="m">
        <header className="wh">
          <div className="whi">
            <Link to="/" className="wlogo" aria-label="InTab PDF home">
              <Logo size={30} />
              <b>InTab</b>
              <em>PDF</em>
            </Link>

            <nav className="wnav" aria-label="Main navigation">
              <Link
                to="/"
                className={isHomeActive ? 'on' : ''}
                aria-current={isHomeActive ? 'page' : undefined}
              >
                Tools
              </Link>
              <Link
                to="/about"
                className={isAboutActive ? 'on' : ''}
                aria-current={isAboutActive ? 'page' : undefined}
              >
                About
              </Link>
              <a
                href="https://github.com/intabtools/intabpdf"
                target="_blank"
                rel="noopener noreferrer"
              >
                Source code
              </a>
              {Boolean(import.meta.env.DEV) && (onSwitchToApp || onSwitchToDesktop) && (
                <>
                  <button
                    type="button"
                    onClick={onSwitchToApp || onSwitchToDesktop}
                    title="Switch to App shell view"
                    style={{ opacity: 0.8 }}
                  >
                    App view
                  </button>
                  <button
                    type="button"
                    onClick={onSwitchToDesktop || onSwitchToApp}
                    title="Switch to Desktop view"
                    style={{ opacity: 0.8 }}
                  >
                    Desktop view
                  </button>
                </>
              )}
            </nav>

            <span className="wsp" />

            <button
              type="button"
              className="wsb"
              onClick={() => setIsPaletteOpen(true)}
              aria-label="Search tools (Ctrl+K)"
            >
              <Search size={16} strokeWidth={1.8} />
              <span>Search tools</span>
              <kbd>Ctrl K</kbd>
            </button>

            <button
              type="button"
              className="ib wsi"
              onClick={() => setIsPaletteOpen(true)}
              aria-label="Search tools"
            >
              <Search size={22} strokeWidth={1.8} />
            </button>

            <button
              type="button"
              className="ib"
              onClick={() => setIsDark((prev) => !prev)}
              aria-label="Toggle light/dark theme"
            >
              {isDark ? <Sun size={22} strokeWidth={1.8} /> : <Moon size={22} strokeWidth={1.8} />}
            </button>
          </div>
        </header>

        <main className="wmain">{children}</main>

        <footer className="wf">
          <div className="wp wfi">
            <div className="wfa">
              <Logo size={30} />
              <div>
                <b>InTab PDF</b>
                <small>Privacy-first PDF tools, made by students for everyone.</small>
              </div>
            </div>

            <div className="wfl">
              <Link to="/">Tools</Link>
              <Link to="/about">About</Link>
              <a
                href="https://github.com/intabtools/intabpdf"
                target="_blank"
                rel="noopener noreferrer"
              >
                Source code
              </a>
            </div>

            <small className="wfc">MIT license, version {APP_VERSION}</small>
          </div>
        </footer>
      </div>

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
      />
    </div>
  );
}
