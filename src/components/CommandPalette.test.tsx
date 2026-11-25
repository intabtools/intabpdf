import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from './ToastContext';
import CommandPalette from './CommandPalette';
import { TOOLS } from '../tools/registry';
import * as platformModule from '../platform';
import { filterAndRankPaletteItems, type SearchablePaletteItem } from './commandPaletteSearch';

afterEach(() => {
  vi.restoreAllMocks();
});

function buildPaletteItemsFromTools(): SearchablePaletteItem[] {
  return TOOLS.map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    keywords: tool.keywords,
    icon: tool.icon,
    action: () => {},
  }));
}

describe('CommandPalette search and discoverability', () => {
  it('renders all 13 registered tools when query is empty without 10-item truncation', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('electron');
    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <CommandPalette isOpen={true} onClose={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );

    for (const tool of TOOLS) {
      expect(html).toContain(tool.name);
    }
    expect(html).toContain('PDF Viewer');
  });

  it('hides PDF Viewer from CommandPalette on web while keeping it on electron and android', () => {
    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('web');
    const webHtml = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <CommandPalette isOpen={true} onClose={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(webHtml).not.toContain('PDF Viewer');

    vi.spyOn(platformModule, 'getPlatformType').mockReturnValue('android');
    const androidHtml = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <CommandPalette isOpen={true} onClose={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(androidHtml).toContain('PDF Viewer');
  });

  it('matches every registered tool by displayed name and by tool ID', () => {
    const items = buildPaletteItemsFromTools();

    for (const tool of TOOLS) {
      const byName = filterAndRankPaletteItems(items, tool.name);
      expect(byName.some((item) => item.id === tool.id)).toBe(true);
      expect(byName[0].id).toBe(tool.id);

      const byId = filterAndRankPaletteItems(items, tool.id);
      expect(byId.some((item) => item.id === tool.id)).toBe(true);
    }
  });

  it('supports multi-word "<Tool> PDF" queries and word-order variations', () => {
    const items = buildPaletteItemsFromTools();

    const expectations: Array<[string, string]> = [
      ['Protect PDF', 'protect'],
      ['Unlock PDF', 'unlock'],
      ['Reorder PDF', 'reorder'],
      ['Sign PDF', 'sign'],
      ['Merge PDF', 'merge'],
      ['Split PDF', 'split'],
      ['Compress PDF', 'compress'],
      ['Text to PDF', 'text-to-pdf'],
      ['PDF Text', 'text-to-pdf'],
      ['pages reorder', 'reorder'],
      ['rotate pages', 'rotate'],
      ['remove pdf', 'remove-pages'],
    ];

    for (const [query, expectedId] of expectations) {
      const results = filterAndRankPaletteItems(items, query);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(expectedId);
    }
  });

  it('finds tools via aliases and partial keywords', () => {
    const items = buildPaletteItemsFromTools();

    const aliasExpectations: Array<[string, string]> = [
      ['encrypt', 'protect'],
      ['decrypt', 'unlock'],
      ['remove password', 'unlock'],
      ['rearrange', 'reorder'],
      ['signature', 'sign'],
      ['shrink', 'compress'],
      ['jpg', 'pdf-to-images'],
      ['png', 'images-to-pdf'],
      ['txt', 'text-to-pdf'],
      ['prot', 'protect'],
    ];

    for (const [query, expectedId] of aliasExpectations) {
      const results = filterAndRankPaletteItems(items, query);
      expect(results.some((item) => item.id === expectedId)).toBe(true);
    }
  });

  it('returns no duplicate items and ranks exact name matches above description matches', () => {
    const items: SearchablePaletteItem[] = [
      {
        id: 'other',
        name: 'Other Utility',
        description: 'Can protect documents too',
        icon: 'file',
        action: () => {},
      },
      {
        id: 'protect',
        name: 'Protect',
        description: 'Lock a PDF with a password',
        keywords: ['encrypt', 'pdf'],
        icon: 'lock',
        action: () => {},
      },
      {
        id: 'protect',
        name: 'Protect',
        description: 'Duplicate entry',
        icon: 'lock',
        action: () => {},
      },
    ];

    const results = filterAndRankPaletteItems(items, 'protect');
    expect(results.map((r) => r.id)).toEqual(['protect', 'other']);
  });
});
