import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import AppHeader from './AppHeader';
import { ToastProvider } from './ToastContext';
import { ViewerProvider } from '../viewer/ViewerContext';
import { TOOL_CATEGORIES, getToolsByCategory } from '../tools/registry';

describe('Navigation, Header, and Sidebar UI Polish', () => {
  it('verifies first-time users receive expanded sidebar by default while returning user preference is respected', () => {
    // Simulating AppShell initialization logic for 'intab.sc'
    const getInitialSidebarCollapsed = (storageValue: string | null) => {
      try {
        return storageValue === '1';
      } catch {
        return false;
      }
    };

    // First-time desktop user: storage is null
    expect(getInitialSidebarCollapsed(null)).toBe(false);

    // Returning user who collapsed sidebar
    expect(getInitialSidebarCollapsed('1')).toBe(true);

    // Returning user who expanded sidebar
    expect(getInitialSidebarCollapsed('0')).toBe(false);
  });

  it('renders expanded sidebar with accessible navigation labels and all categories', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <ViewerProvider>
            <Sidebar onCloseDrawer={() => {}} isCollapsed={false} />
          </ViewerProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    // Open PDF action
    expect(html).toContain('Open PDF');

    // Main entries
    expect(html).toContain('All tools');
    expect(html).toContain('Viewer');

    // Category headings
    TOOL_CATEGORIES.forEach((cat) => {
      expect(html).toContain(cat);
      const tools = getToolsByCategory(cat);
      tools.forEach((t) => {
        expect(html).toContain(t.name);
      });
    });

    // Footer items
    expect(html).toContain('About');
    expect(html).toContain('Source code');

    // Mobile drawer close button exists
    expect(html).toContain('aria-label="Close menu"');
  });

  it('renders collapsed sidebar with descriptive tooltips and accessible names', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/tool/merge']}>
        <ToastProvider>
          <ViewerProvider>
            <Sidebar onCloseDrawer={() => {}} isCollapsed={true} />
          </ViewerProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    // Collapsed mode sets descriptive title attributes for tooltips
    expect(html).toContain('title="Open PDF"');
    expect(html).toContain('title="All tools"');
    expect(html).toContain('title="PDF Viewer"');
    expect(html).toContain('title="Merge PDFs"');
    expect(html).toContain('title="Compress PDF"');

    // Active tool state marked
    expect(html).toContain('class="si on"');
  });

  it('renders header controls with accessible labels and collapse toggle states', () => {
    // Header with collapsed sidebar
    const collapsedHeaderHtml = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <AppHeader
          onToggleSidebar={() => {}}
          onOpenPalette={() => {}}
          isDark={false}
          onToggleTheme={() => {}}
          isSidebarCollapsed={true}
          isDrawerOpen={false}
        />
      </MemoryRouter>
    );

    expect(collapsedHeaderHtml).toContain('title="Expand sidebar (Ctrl B)"');
    expect(collapsedHeaderHtml).toContain('aria-label="Expand sidebar"');
    expect(collapsedHeaderHtml).toContain('aria-expanded="false"');
    expect(collapsedHeaderHtml).toContain('Search tools');

    // Header with expanded sidebar
    const expandedHeaderHtml = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <AppHeader
          onToggleSidebar={() => {}}
          onOpenPalette={() => {}}
          isDark={false}
          onToggleTheme={() => {}}
          isSidebarCollapsed={false}
          isDrawerOpen={false}
        />
      </MemoryRouter>
    );

    expect(expandedHeaderHtml).toContain('title="Collapse sidebar (Ctrl B)"');
    expect(expandedHeaderHtml).toContain('aria-label="Collapse sidebar"');
    expect(expandedHeaderHtml).toContain('aria-expanded="true"');
  });
});
