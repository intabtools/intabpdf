import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import StatusBar from './StatusBar';
import AppShell from './AppShell';
import WebShell from './WebShell';
import { ToastProvider } from './ToastContext';
import { ViewerProvider } from '../viewer/ViewerContext';
import * as platformModule from '../platform';
import { APP_VERSION } from '../config';

describe('Desktop Bottom Status Bar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders StatusBar with MIT license, dynamic app version, and search shortcut', () => {
    const html = renderToString(<StatusBar />);

    expect(html).toContain('class="stb"');
    expect(html).toContain('aria-label="Status bar"');
    expect(html).toContain('<span>MIT</span>');
    expect(html).toContain(APP_VERSION);
    expect(html).toContain('<span>Ctrl K to search</span>');
    expect(html).toContain('class="sp"');
  });

  it('renders StatusBar in AppShell on desktop platform (Electron)', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('electron');

    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <ViewerProvider>
            <AppShell>
              <div>Desktop App Content</div>
            </AppShell>
          </ViewerProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    expect(html).toContain('class="stb"');
    expect(html).toContain('MIT');
    expect(html).toContain(APP_VERSION);
    expect(html).toContain('Ctrl K to search');
  });

  it('suppresses StatusBar in AppShell on Android platform', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('android');

    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <ViewerProvider>
            <AppShell>
              <div>Android App Content</div>
            </AppShell>
          </ViewerProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    // StatusBar must not be rendered on Android
    expect(html).not.toContain('class="stb"');
    expect(html).not.toContain('Ctrl K to search');
    // But mobile bottom nav must be present
    expect(html).toContain('class="vt"');
  });

  it('suppresses StatusBar when showAppLayout is false', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('electron');

    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <ViewerProvider>
            <AppShell showAppLayout={false}>
              <div>Full Screen Viewer Content</div>
            </AppShell>
          </ViewerProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    expect(html).not.toContain('class="stb"');
  });

  it('preserves website WebShell footer and does not include desktop status bar in web shell', () => {
    const html = renderToString(
      <ToastProvider>
        <MemoryRouter initialEntries={['/']}>
          <WebShell>
            <div>Web Shell Content</div>
          </WebShell>
        </MemoryRouter>
      </ToastProvider>
    );

    // Must contain website footer (.wf)
    expect(html).toContain('class="wf"');
    expect(html).toContain('MIT license, version');
    // Must NOT contain desktop status bar (.stb)
    expect(html).not.toContain('class="stb"');
    expect(html).not.toContain('Ctrl K to search');
  });

  it('verifies CSS rules in base.css specify 26px height, desktop flex layout, and Android suppression', () => {
    const cssPath = path.resolve(__dirname, '../styles/base.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Default .stb definition
    expect(css).toMatch(/\.stb\s*\{[^}]*height:\s*26px;/);
    expect(css).toMatch(/\.stb\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/\.stb\s*\{[^}]*font-family:\s*var\(--font-mono\);/);
    expect(css).toMatch(/\.stb\s*\{[^}]*font-size:\s*11px;/);

    // Android override
    expect(css).toMatch(/html\[data-platform="android"\]\s+\.stb\s*\{[^}]*display:\s*none\s*!important;/);

    // Desktop display flex at min-width 900px
    expect(css).toContain('.stb {\n    display: flex;\n  }');
  });
});
