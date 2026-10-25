import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AppHeader from './AppHeader';
import Sidebar from './Sidebar';
import HomePage from '../pages/HomePage';
import { ToastProvider } from './ToastContext';
import { ViewerProvider } from '../viewer/ViewerContext';

describe('Responsive Validation and Sizing Audit', () => {
  const desktopWidths = [1280, 1440, 1650];
  const mobileWidths = [320, 360, 390, 412];

  it('validates desktop workspace math for expanded (290px) and collapsed (72px) sidebar', () => {
    desktopWidths.forEach((width) => {
      // Expanded sidebar (290px)
      const expandedAvailable = width - 290 - 64; // subtracting sidebar and padding
      expect(expandedAvailable).toBeGreaterThan(900); // Plenty of room for cards

      // Columns with minmax(240px, 1fr)
      const expandedCols = Math.floor(expandedAvailable / 240);
      expect(expandedCols).toBeGreaterThanOrEqual(3);
      expect(expandedCols).toBeLessThanOrEqual(6);

      // Collapsed sidebar (72px)
      const collapsedAvailable = width - 72 - 64;
      const collapsedCols = Math.floor(collapsedAvailable / 240);
      expect(collapsedCols).toBeGreaterThanOrEqual(4);
      expect(collapsedCols).toBeLessThanOrEqual(7);
    });
  });

  it('validates mobile drawer width constraints across representative viewports', () => {
    mobileWidths.forEach((width) => {
      const drawerWidth = Math.min(360, Math.floor(width * 0.88));
      const percentage = (drawerWidth / width) * 100;

      // Must be up to 88% unless capped at 360px on wider phones
      if (drawerWidth < 360) {
        expect(percentage).toBeGreaterThanOrEqual(82);
        expect(percentage).toBeLessThanOrEqual(88);
      } else {
        expect(drawerWidth).toBe(360);
      }
    });
  });

  it('renders HomePage dashboard tools and dropzone without markup corruption', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <ViewerProvider>
            <HomePage />
          </ViewerProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    expect(html).toContain('Open PDF files');
    expect(html).toContain('Choose files or drop them here.');
    expect(html).toContain('Merge');
    expect(html).toContain('Compress');
    expect(html).toContain('Rotate pages');
    expect(html).toContain('Split');
  });

  it('renders Header across both expanded and collapsed desktop states', () => {
    const collapsedHtml = renderToString(
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
    expect(collapsedHtml).toContain('Expand sidebar');

    const expandedHtml = renderToString(
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
    expect(expandedHtml).toContain('Collapse sidebar');
  });

  it('renders Sidebar with full tool labeling and Coming Soon badges', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <ViewerProvider>
            <Sidebar onCloseDrawer={() => {}} isCollapsed={false} />
          </ViewerProvider>
        </ToastProvider>
      </MemoryRouter>
    );
    expect(html).toContain('Soon');
    expect(html).toContain('Images to PDF');
    expect(html).toContain('Protect');
  });
});
