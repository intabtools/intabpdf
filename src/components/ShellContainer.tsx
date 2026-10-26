import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import AppShell from './AppShell';
import WebShell from './WebShell';
import { ShellContext, type ShellMode } from './shellContextDef';
import { getPlatformType } from '../platform';
import { getDefaultShellVisibility } from '../config';

export default function ShellContainer({ children }: { children: ReactNode }): ReactNode {
  const [shell, setShellState] = useState<ShellMode>(() => {
    // 1. Check URL param ?shell=
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlShell = params.get('shell');
      if (urlShell === 'app' || urlShell === 'web') {
        return urlShell;
      }
      // 2. Check localStorage
      try {
        const saved = localStorage.getItem('intab.shell');
        if (saved === 'app' || saved === 'web') {
          return saved;
        }
      } catch {
        // Ignore
      }
    }

    // 3. Default to 'app' shell for InTabPDF desktop/mobile application
    return getPlatformType() === 'web' ? 'web' : 'app';
  });

  const [showAppLayout, setShowAppLayout] = useState<boolean>(() => {
    return getDefaultShellVisibility(getPlatformType());
  });

  const setShell = (mode: ShellMode) => {
    setShellState(mode);
    try {
      localStorage.setItem('intab.shell', mode);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    const checkUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const urlShell = params.get('shell');
      if (urlShell === 'app' || urlShell === 'web') {
        setShellState(urlShell);
      }
    };
    window.addEventListener('popstate', checkUrl);
    return () => window.removeEventListener('popstate', checkUrl);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.platform = getPlatformType();
      document.documentElement.dataset.shell = shell;
    }
  }, [shell]);

  return (
    <ShellContext.Provider value={{ shell, setShell, showAppLayout, setShowAppLayout }}>
      {shell === 'web' ? (
        <WebShell
          onSwitchToApp={() => setShell('app')}
          onSwitchToDesktop={() => setShell('app')}
          showAppLayout={showAppLayout}
        >
          {children}
        </WebShell>
      ) : (
        <AppShell onSwitchToWeb={() => setShell('web')} showAppLayout={showAppLayout}>{children}</AppShell>
      )}
    </ShellContext.Provider>
  );
}

