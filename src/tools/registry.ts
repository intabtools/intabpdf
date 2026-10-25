// The single authoritative list of PDF tools in InTab PDF.
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { ToolCategory, ToolComponentProps, ToolDefinition } from './types';

export const TOOL_CATEGORIES: ToolCategory[] = [
  'Create',
  'Organize',
  'Shrink and secure',
  'Sign and convert',
];

export const TOOLS: ToolDefinition[] = [
  // Create
  {
    id: 'images-to-pdf',
    name: 'Images to PDF',
    description: 'Turn photos into one PDF',
    category: 'Create',
    icon: 'image',
    fileType: 'img',
    actionVerb: 'Create a PDF from',
    noun: 'photo',
    outputName: 'photos.pdf',
    availability: 'available',
    component: () => import('./modules/ImagesToPdfTool'),
    options: [
      { id: 'fit', label: 'Fit photos to page', description: 'Scale each photo to the page', defaultValue: true },
      { id: 'shrink', label: 'Shrink large photos', description: 'Smaller file, same look', defaultValue: false },
    ],
  },
  {
    id: 'text-to-pdf',
    name: 'Text to PDF',
    description: 'Set plain text as pages',
    category: 'Create',
    icon: 'type',
    fileType: 'txt',
    actionVerb: 'Create a PDF from',
    noun: 'file',
    outputName: 'text.pdf',
    availability: 'coming-soon',
    options: [
      { id: 'page-nums', label: 'Add page numbers', description: 'Bottom centre of every page', defaultValue: true },
      { id: 'mono', label: 'Monospace font', description: 'Good for code and logs', defaultValue: false },
    ],
  },

  // Organize
  {
    id: 'merge',
    name: 'Merge',
    description: 'Combine several PDFs into one',
    category: 'Organize',
    icon: 'layers',
    fileType: 'pdf',
    actionVerb: 'Merge',
    noun: 'file',
    outputName: 'merged.pdf',
    availability: 'available',
    component: () => import('./modules/MergeTool'),
    options: [
      { id: 'bookmarks', label: 'Keep bookmarks', description: 'Carry them over from each file', defaultValue: true },
      { id: 'page-nums', label: 'Add page numbers', description: 'Bottom centre of every page', defaultValue: false },
    ],
  },
  {
    id: 'split',
    name: 'Split',
    description: 'Pull pages out into new files',
    category: 'Organize',
    icon: 'scissors',
    fileType: 'pdf',
    actionVerb: 'Split',
    noun: 'file',
    outputName: 'split.zip',
    availability: 'available',
    component: () => import('./modules/SplitTool'),
    options: [
      { id: 'one-per-page', label: 'One file per page', description: 'Otherwise you pick the ranges', defaultValue: false },
      { id: 'bookmarks', label: 'Keep bookmarks', description: 'Carry them into each part', defaultValue: true },
    ],
  },
  {
    id: 'reorder',
    name: 'Reorder pages',
    description: 'Drag pages into a new order',
    category: 'Organize',
    icon: 'grid',
    fileType: 'pdf',
    actionVerb: 'Reorder',
    noun: 'file',
    outputName: 'reordered.pdf',
    availability: 'coming-soon',
    options: [
      { id: 'thumbs', label: 'Show thumbnails', description: 'See every page before you move it', defaultValue: true },
    ],
  },
  {
    id: 'rotate',
    name: 'Rotate pages',
    description: 'Turn pages the right way up',
    category: 'Organize',
    icon: 'rotate',
    fileType: 'pdf',
    actionVerb: 'Rotate',
    noun: 'file',
    outputName: 'rotated.pdf',
    availability: 'available',
    component: () => import('./modules/RotateTool'),
    options: [
      { id: 'cw', label: 'Turn clockwise', description: 'Off turns pages anticlockwise', defaultValue: true },
      { id: 'all-pages', label: 'Rotate every page', description: 'Off lets you pick pages', defaultValue: true },
    ],
  },
  {
    id: 'remove-pages',
    name: 'Remove pages',
    description: 'Delete the pages you do not need',
    category: 'Organize',
    icon: 'x',
    fileType: 'pdf',
    actionVerb: 'Remove pages from',
    noun: 'file',
    outputName: 'trimmed.pdf',
    availability: 'available',
    component: () => import('./modules/RemovePagesTool'),
    options: [
      { id: 'confirm', label: 'Confirm before removing', description: 'Show the pages first', defaultValue: true },
    ],
  },

  // Shrink and secure
  {
    id: 'compress',
    name: 'Compress',
    description: 'Make large files smaller',
    category: 'Shrink and secure',
    icon: 'shrink',
    fileType: 'pdf',
    actionVerb: 'Compress',
    noun: 'file',
    outputName: 'compressed.pdf',
    availability: 'available',
    component: () => import('./modules/CompressTool'),
    options: [
      { id: 'downsample', label: 'Downsample large photos', description: 'Resize high-resolution images for screen viewing', defaultValue: true },
      { id: 'strip-meta', label: 'Strip metadata', description: 'Remove author, dates, and metadata streams', defaultValue: false },
    ],
  },
  {
    id: 'protect',
    name: 'Protect',
    description: 'Lock a PDF with a password',
    category: 'Shrink and secure',
    icon: 'lock',
    fileType: 'pdf',
    actionVerb: 'Protect',
    noun: 'file',
    outputName: 'protected.pdf',
    availability: 'coming-soon',
    options: [
      { id: 'pwd-open', label: 'Ask for a password to open', description: 'You choose the password next', defaultValue: true },
      { id: 'block-print', label: 'Block printing', description: 'Reading stays allowed', defaultValue: false },
    ],
  },
  {
    id: 'unlock',
    name: 'Unlock',
    description: 'Remove a password you know',
    category: 'Shrink and secure',
    icon: 'unlock',
    fileType: 'pdf',
    actionVerb: 'Unlock',
    noun: 'file',
    outputName: 'unlocked.pdf',
    availability: 'coming-soon',
    options: [
      { id: 'know-pwd', label: 'I know the password', description: 'Required to remove it', defaultValue: true },
    ],
  },

  // Sign and convert
  {
    id: 'sign',
    name: 'Sign',
    description: 'Draw or type your signature',
    category: 'Sign and convert',
    icon: 'pen',
    fileType: 'pdf',
    actionVerb: 'Sign',
    noun: 'file',
    outputName: 'signed.pdf',
    availability: 'coming-soon',
    options: [
      { id: 'add-date', label: 'Add the date', description: 'Next to your signature', defaultValue: false },
      { id: 'save-sig', label: 'Save my signature', description: 'Stays on this device only', defaultValue: false },
    ],
  },
  {
    id: 'pdf-to-images',
    name: 'PDF to images',
    description: 'Save each page as a picture',
    category: 'Sign and convert',
    icon: 'image',
    fileType: 'pdf',
    actionVerb: 'Convert',
    noun: 'file',
    outputName: 'pages.zip',
    availability: 'coming-soon',
    options: [
      { id: 'hi-res', label: 'High resolution', description: 'Larger images', defaultValue: false },
      { id: 'png', label: 'Use PNG', description: 'Instead of JPG', defaultValue: false },
    ],
  },
  {
    id: 'extract-text',
    name: 'Extract text',
    description: 'Copy out the text of a PDF',
    category: 'Sign and convert',
    icon: 'text',
    fileType: 'pdf',
    actionVerb: 'Extract text from',
    noun: 'file',
    outputName: 'text.txt',
    availability: 'coming-soon',
    options: [
      { id: 'line-breaks', label: 'Keep line breaks', description: 'Off joins lines into paragraphs', defaultValue: true },
    ],
  },
];

export function getToolById(id: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.category === category);
}

export function getAvailableTools(): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.availability === 'available');
}

export function getComingSoonTools(): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.availability === 'coming-soon');
}

export function isToolImplemented(id: string): boolean {
  const tool = getToolById(id);
  return tool?.availability === 'available';
}

const componentCache = new Map<string, LazyExoticComponent<ComponentType<ToolComponentProps>>>();

/**
 * Resolves the lazy component wrapper for an available tool.
 * Caches wrappers so React.lazy is only invoked once per tool definition.
 */
export function getToolComponent(
  tool: ToolDefinition
): LazyExoticComponent<ComponentType<ToolComponentProps>> | null {
  if (!tool.component) return null;
  let Comp = componentCache.get(tool.id);
  if (!Comp) {
    Comp = lazy(tool.component);
    componentCache.set(tool.id, Comp);
  }
  return Comp;
}

/**
 * Validates the tool registry for configuration integrity,
 * detecting duplicate IDs, missing categories, and unavailable components.
 */
export function validateRegistry(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const tool of TOOLS) {
    if (!tool.id || tool.id.trim() === '') {
      errors.push('Found tool definition with empty ID');
    } else if (seenIds.has(tool.id)) {
      errors.push(`Duplicate tool ID detected: "${tool.id}"`);
    }
    seenIds.add(tool.id);

    if (!TOOL_CATEGORIES.includes(tool.category)) {
      errors.push(`Tool "${tool.id}" has invalid category: "${tool.category}"`);
    }

    if (tool.availability === 'available' && !tool.component) {
      errors.push(`Tool "${tool.id}" is marked available but lacks a lazy component loader.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
