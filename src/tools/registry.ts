// The single authoritative list and helper queries for PDF tools in InTab PDF.
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { ToolCategory, ToolComponentProps, ToolDefinition } from './types';
import { TOOL_CATEGORIES, TOOLS } from './toolDefinitions';

export { TOOL_CATEGORIES, TOOLS };

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
