import { BrowserRouter, HashRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';

interface AppRouterProps {
  children: ReactNode;
}

export default function AppRouter({ children }: AppRouterProps) {
  // Ensure the desktop and native mobile builds use HashRouter for file/protocol routing resilience
  const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform();
  const Router = import.meta.env.MODE === 'desktop' || isNative ? HashRouter : BrowserRouter;
  return <Router>{children}</Router>;
}
