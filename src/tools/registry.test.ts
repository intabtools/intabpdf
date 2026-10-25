import { describe, expect, it } from 'vitest';
import {
  TOOL_CATEGORIES,
  TOOLS,
  getAvailableTools,
  getComingSoonTools,
  getToolById,
  getToolsByCategory,
  isToolImplemented,
  validateRegistry,
} from './registry';

describe('tools/registry', () => {
  it('contains all 4 tool categories from concept art', () => {
    expect(TOOL_CATEGORIES).toEqual([
      'Create',
      'Organize',
      'Shrink and secure',
      'Sign and convert',
    ]);
  });

  it('contains all 13 tools from concept art', () => {
    expect(TOOLS.length).toBe(13);
  });

  it('has unique IDs for every tool', () => {
    const ids = TOOLS.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('assigns every tool to a recognized category', () => {
    TOOLS.forEach((tool) => {
      expect(TOOL_CATEGORIES).toContain(tool.category);
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.actionVerb).toBeTruthy();
      expect(tool.noun).toBeTruthy();
      expect(tool.outputName).toBeTruthy();
      expect(Array.isArray(tool.options)).toBe(true);
      expect(['available', 'coming-soon']).toContain(tool.availability);
    });
  });

  it('retrieves tools by ID', () => {
    const mergeTool = getToolById('merge');
    expect(mergeTool).toBeDefined();
    expect(mergeTool?.name).toBe('Merge');
    expect(mergeTool?.category).toBe('Organize');
    expect(mergeTool?.outputName).toBe('merged.pdf');
    expect(mergeTool?.availability).toBe('available');

    const compressTool = getToolById('compress');
    expect(compressTool).toBeDefined();
    expect(compressTool?.name).toBe('Compress');
    expect(compressTool?.availability).toBe('available');

    const protectTool = getToolById('protect');
    expect(protectTool).toBeDefined();
    expect(protectTool?.name).toBe('Protect');
    expect(protectTool?.availability).toBe('coming-soon');

    const nonExistent = getToolById('unknown-tool');
    expect(nonExistent).toBeUndefined();
  });

  it('retrieves tools by category', () => {
    const createTools = getToolsByCategory('Create');
    expect(createTools.map((t) => t.id)).toEqual(['images-to-pdf', 'text-to-pdf']);

    const organizeTools = getToolsByCategory('Organize');
    expect(organizeTools.map((t) => t.id)).toEqual([
      'merge',
      'split',
      'reorder',
      'rotate',
      'remove-pages',
    ]);

    const shrinkTools = getToolsByCategory('Shrink and secure');
    expect(shrinkTools.map((t) => t.id)).toEqual(['compress', 'protect', 'unlock']);

    const signTools = getToolsByCategory('Sign and convert');
    expect(signTools.map((t) => t.id)).toEqual(['sign', 'pdf-to-images', 'extract-text']);
  });

  it('distinguishes available vs coming soon tools', () => {
    const available = getAvailableTools();
    expect(available.map((t) => t.id).sort()).toEqual([
      'compress',
      'images-to-pdf',
      'merge',
      'remove-pages',
      'rotate',
      'split',
    ]);

    const comingSoon = getComingSoonTools();
    expect(comingSoon.length).toBe(7);

    expect(isToolImplemented('images-to-pdf')).toBe(true);
    expect(isToolImplemented('merge')).toBe(true);
    expect(isToolImplemented('rotate')).toBe(true);
    expect(isToolImplemented('remove-pages')).toBe(true);
    expect(isToolImplemented('split')).toBe(true);
    expect(isToolImplemented('compress')).toBe(true);
    expect(isToolImplemented('protect')).toBe(false);
  });

  it('passes comprehensive registry validation', () => {
    const { valid, errors } = validateRegistry();
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('lazy component loaders resolve properly for available tools', async () => {
    const available = getAvailableTools();
    for (const tool of available) {
      expect(tool.component).toBeDefined();
      const mod = await tool.component!();
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe('function');
    }
  });

  it('has truthful options for rotate tool without misleading page-selection claims', () => {
    const rotate = getToolById('rotate');
    expect(rotate).toBeDefined();
    expect(rotate?.options.some((opt) => opt.id === 'all-pages')).toBe(false);
    expect(rotate?.options.some((opt) => opt.description.includes('lets you pick pages'))).toBe(false);
    const cwOption = rotate?.options.find((opt) => opt.id === 'cw');
    expect(cwOption).toBeDefined();
    expect(cwOption?.description).toContain('all pages');
  });
});
