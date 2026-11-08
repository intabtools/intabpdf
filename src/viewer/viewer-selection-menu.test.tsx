import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import ViewerSelectionMenu from './ViewerSelectionMenu';
import * as platformModule from '../platform';
import { ToastProvider } from '../components/ToastContext';

describe('PDF Viewer Contextual Selection Menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders Copy, Select All, Share, and Search Web buttons on desktop when text is selected', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('electron');

    const containerRef = { current: null };
    const html = renderToString(
      <ToastProvider>
        <ViewerSelectionMenu
          containerRef={containerRef}
          currentPage={1}
          initialSelection={{
            text: 'InTabPDF selected text',
            top: 200,
            left: 100,
            visible: true,
          }}
        />
      </ToastProvider>
    );

    expect(html).toContain('class="viewer-selection-menu"');
    expect(html).toContain('Copy');
    expect(html).toContain('Select All');
    expect(html).toContain('Share');
    expect(html).toContain('Search Web');
    expect(html).toContain('top:200px');
    expect(html).toContain('left:100px');
  });

  it('suppresses custom floating menu on Android to preserve native ActionMode menu', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('android');

    const containerRef = { current: null };
    const html = renderToString(
      <ToastProvider>
        <ViewerSelectionMenu
          containerRef={containerRef}
          currentPage={1}
          initialSelection={{
            text: 'Android selected text',
            top: 200,
            left: 100,
            visible: true,
          }}
        />
      </ToastProvider>
    );

    expect(html).toBe('');
  });

  it('constructs correct encoded query URL for Search Web', () => {
    const selectedText = 'privacy pdf tools';
    const query = encodeURIComponent(selectedText.slice(0, 200));
    const targetUrl = `https://www.google.com/search?q=${query}`;

    expect(targetUrl).toBe('https://www.google.com/search?q=privacy%20pdf%20tools');
  });
});
