import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { useShell } from '../hooks/useShell';
import AppHeader from './AppHeader';
import BottomNav from './BottomNav';
import CommandPalette from './CommandPalette';
import NavigationRail from './NavigationRail';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';

interface AppShellProps {
  children: ReactNode;
  onSwitchToWeb?: () => void;
  showAppLayout?: boolean;
}

export default function AppShell({ children, onSwitchToWeb, showAppLayout = true }: AppShellProps): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { setShowAppLayout } = useShell();

  // Dark mode state with persistence in localStorage (permitted by privacy rules)
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('intab.theme');
      if (saved) return saved === 'dark';
    } catch {
      // Fall through to system preference
    }
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  });

  // Collapsed sidebar state for desktop
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('intab.sc') === '1';
    } catch {
      return false;
    }
  });

  // Drawer state for mobile/tablet
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Command palette state
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  // Synchronize data-theme attribute on root element
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    try {
      localStorage.setItem('intab.theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore
    }
  }, [isDark]);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => !prev);
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('intab.sc', next ? '1' : '0');
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const handleToggleMenu = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 900) {
      toggleSidebarCollapse();
    } else {
      setIsDrawerOpen((prev) => !prev);
    }
  }, [toggleSidebarCollapse]);

  // Global keyboard shortcuts: Ctrl+K / Ctrl+B / Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;

      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      } else if (isMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        if (typeof window !== 'undefined' && window.innerWidth >= 900) {
          e.preventDefault();
          toggleSidebarCollapse();
        }
      } else if (e.key === 'Escape') {
        if (!showAppLayout) {
          setShowAppLayout(true);
        } else if (isPaletteOpen) {
          setIsPaletteOpen(false);
        } else if (isDrawerOpen) {
          setIsDrawerOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaletteOpen, isDrawerOpen, toggleSidebarCollapse, showAppLayout, setShowAppLayout]);

  // Android hardware back button integration
  useEffect(() => {
    if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;
    App.addListener('backButton', () => {
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(escapeEvent);
      if (escapeEvent.defaultPrevented) {
        return;
      }

      if (!showAppLayout) {
        setShowAppLayout(true);
      } else if (isPaletteOpen) {
        setIsPaletteOpen(false);
      } else if (isDrawerOpen) {
        setIsDrawerOpen(false);
      } else if (location.pathname !== '/') {
        navigate(-1);
      } else {
        void App.exitApp();
      }
    }).then((handle) => {
      cleanup = () => handle.remove();
    }).catch(() => undefined);

    return () => {
      if (cleanup) cleanup();
    };
  }, [isPaletteOpen, isDrawerOpen, location.pathname, navigate, showAppLayout, setShowAppLayout]);

  // Close mobile drawer when route changes during render
  const [prevPathname, setPrevPathname] = useState(location.pathname);
  if (prevPathname !== location.pathname) {
    setPrevPathname(location.pathname);
    setIsDrawerOpen(false);
  }

  const isSubPage = location.pathname !== '/';
  const isViewerPage = location.pathname.startsWith('/viewer');

  // Derive page title for breadcrumb
  let subTitle: string | undefined;
  if (location.pathname === '/viewer' || location.pathname.startsWith('/viewer')) {
    subTitle = undefined;
  } else if (location.pathname === '/about') {
    subTitle = 'About';
  } else if (location.pathname.startsWith('/tool/')) {
    const toolId = location.pathname.replace('/tool/', '');
    subTitle = toolId
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return (
    <div
      className={`app ${isSubPage ? 'sub' : ''} ${isDrawerOpen ? 'dr' : ''} ${
        isSidebarCollapsed ? 'sc' : ''
      } ${!showAppLayout ? 'full-bleed' : ''} ${isViewerPage ? 'is-viewer' : ''}`}
    >
      {showAppLayout && (
        <AppHeader
          onToggleSidebar={handleToggleMenu}
          onOpenPalette={() => setIsPaletteOpen(true)}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          subTitle={subTitle}
          isSidebarCollapsed={isSidebarCollapsed}
          isDrawerOpen={isDrawerOpen}
        />
      )}

      <div className="body">
        {showAppLayout && !isViewerPage && <NavigationRail />}
        {showAppLayout && !isViewerPage && (
          <Sidebar
            onCloseDrawer={() => setIsDrawerOpen(false)}
            isCollapsed={isSidebarCollapsed}
          />
        )}
        <main className={`main ${isViewerPage ? 'flush' : ''}`} id="main-content">
          <div className={`an ${isViewerPage ? 'flush-wrap' : ''}`}>{children}</div>
        </main>
      </div>

      {showAppLayout && <BottomNav />}
      {showAppLayout && <StatusBar onSwitchToWeb={onSwitchToWeb} />}

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
      />
    </div>
  );
}
