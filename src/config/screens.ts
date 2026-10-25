// Centralized application screen configuration, initial destinations, and routing resolution.
import type { PlatformType } from '../platform/types';
import { getToolById } from '../tools/registry';

export type ScreenId = 'home' | 'viewer' | 'about' | 'tool';

export interface AppConfiguration {
  enabledScreens: Record<ScreenId, boolean>;
  initialDestinations: Record<PlatformType, string>;
  defaultShellVisibility: Record<PlatformType, boolean>;
}

export const APP_CONFIG: AppConfiguration = {
  enabledScreens: {
    home: true,
    viewer: true,
    about: true,
    tool: true,
  },
  initialDestinations: {
    web: '/',
    electron: '/',
    android: '/',
  },
  defaultShellVisibility: {
    web: true,
    electron: true,
    android: true,
  },
};

/**
 * Checks whether a particular screen is enabled in configuration.
 */
export function isScreenEnabled(screenId: ScreenId): boolean {
  return APP_CONFIG.enabledScreens[screenId] ?? false;
}

/**
 * Retrieves the configured initial destination for a given platform.
 */
export function getInitialDestination(platform: PlatformType): string {
  return APP_CONFIG.initialDestinations[platform] || '/';
}

/**
 * Retrieves default shell visibility for a given platform.
 */
export function getDefaultShellVisibility(platform: PlatformType): boolean {
  return APP_CONFIG.defaultShellVisibility[platform] ?? true;
}

/**
 * Validates whether a target route path is enabled and points to an available destination.
 */
export function isValidDestination(path: string): boolean {
  if (!path || path === '/' || path === '/home') {
    return isScreenEnabled('home');
  }
  if (path === '/viewer') {
    return isScreenEnabled('viewer');
  }
  if (path === '/about') {
    return isScreenEnabled('about');
  }
  if (path.startsWith('/tool/')) {
    if (!isScreenEnabled('tool')) return false;
    const toolId = path.replace('/tool/', '').split('?')[0].split('#')[0];
    const tool = getToolById(toolId);
    return !!tool && tool.availability === 'available';
  }
  return false;
}

/**
 * Validates and resolves a requested navigation path.
 * If the destination is unknown, disabled, or an unready tool,
 * selects a safe fallback destination for the platform.
 */
export function resolveDestination(path: string, platform: PlatformType): string {
  const configured = getInitialDestination(platform);
  const fallback = isValidDestination(configured) ? configured : '/';

  if (isValidDestination(path)) {
    return path === '/home' ? '/' : path;
  }

  return fallback;
}
