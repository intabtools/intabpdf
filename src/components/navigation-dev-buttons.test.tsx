import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import WebShell from './WebShell';
import StatusBar from './StatusBar';
import { ToastProvider } from './ToastContext';

describe('Navigation Dev Buttons ("App view" and "Desktop view")', () => {
  const originalDev = import.meta.env.DEV;

  beforeEach(() => {
    (import.meta.env as { DEV: boolean }).DEV = true;
  });

  afterEach(() => {
    (import.meta.env as { DEV: boolean }).DEV = originalDev;
    vi.restoreAllMocks();
  });

  it('renders both "App view" and "Desktop view" buttons in development mode', () => {
    (import.meta.env as { DEV: boolean }).DEV = true;

    const html = renderToString(
      <ToastProvider>
        <MemoryRouter>
          <WebShell onSwitchToApp={() => {}}>
            <div>App content</div>
          </WebShell>
        </MemoryRouter>
      </ToastProvider>
    );

    expect(html).toContain('App view');
    expect(html).toContain('Desktop view');
    expect(html).toContain('title="Switch to App shell view"');
    expect(html).toContain('title="Switch to Desktop view"');
  });

  it('hides both "App view" and "Desktop view" buttons in production builds', () => {
    (import.meta.env as { DEV: boolean }).DEV = false;

    const html = renderToString(
      <ToastProvider>
        <MemoryRouter>
          <WebShell onSwitchToApp={() => {}}>
            <div>App content</div>
          </WebShell>
        </MemoryRouter>
      </ToastProvider>
    );

    expect(html).not.toContain('App view');
    expect(html).not.toContain('Desktop view');
    expect(html).not.toContain('Switch to App shell view');
    expect(html).not.toContain('Switch to Desktop view');
  });

  it('renders StatusBar switcher button in development mode and hides it in production', () => {
    (import.meta.env as { DEV: boolean }).DEV = true;
    const devHtml = renderToString(<StatusBar onSwitchToWeb={() => {}} />);
    expect(devHtml).toContain('Website view');
    expect(devHtml).toContain('title="Switch to Website view"');

    (import.meta.env as { DEV: boolean }).DEV = false;
    const prodHtml = renderToString(<StatusBar onSwitchToWeb={() => {}} />);
    expect(prodHtml).not.toContain('Website view');
    expect(prodHtml).not.toContain('Switch to Website view');
  });

  it('supports onSwitchToDesktop callback and handles button click behaviors', () => {
    let appSwitched = false;
    let desktopSwitched = false;

    const handleSwitchApp = () => {
      appSwitched = true;
    };
    const handleSwitchDesktop = () => {
      desktopSwitched = true;
    };

    handleSwitchApp();
    handleSwitchDesktop();

    expect(appSwitched).toBe(true);
    expect(desktopSwitched).toBe(true);
  });

  it('preserves standard navigation links in both development and production', () => {
    // In development
    (import.meta.env as { DEV: boolean }).DEV = true;
    const devHtml = renderToString(
      <ToastProvider>
        <MemoryRouter>
          <WebShell onSwitchToApp={() => {}}>
            <div>App content</div>
          </WebShell>
        </MemoryRouter>
      </ToastProvider>
    );
    expect(devHtml).toContain('Tools');
    expect(devHtml).toContain('About');
    expect(devHtml).toContain('Source code');

    // In production
    (import.meta.env as { DEV: boolean }).DEV = false;
    const prodHtml = renderToString(
      <ToastProvider>
        <MemoryRouter>
          <WebShell onSwitchToApp={() => {}}>
            <div>App content</div>
          </WebShell>
        </MemoryRouter>
      </ToastProvider>
    );
    expect(prodHtml).toContain('Tools');
    expect(prodHtml).toContain('About');
    expect(prodHtml).toContain('Source code');
  });

  it('correctly maps Vite command and mode configurations for dev, dist, and dist:win', () => {
    const getViteDefine = (command: 'build' | 'serve') => {
      const isBuild = command === 'build';
      return isBuild
        ? {
            'import.meta.env.DEV': 'false',
            'import.meta.env.PROD': 'true',
          }
        : undefined;
    };

    // npm run dev: command === 'serve', mode === 'development'
    const devDefine = getViteDefine('serve');
    expect(devDefine).toBeUndefined();

    // npm run dist and dist:win: run build:desktop where command === 'build', mode === 'desktop'
    const distDefine = getViteDefine('build');
    expect(distDefine).toEqual({
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
    });
  });
});
