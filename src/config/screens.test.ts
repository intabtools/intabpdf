import { describe, expect, it } from 'vitest';
import {
  APP_CONFIG,
  getDefaultShellVisibility,
  getInitialDestination,
  isScreenEnabled,
  resolveDestination,
} from './screens';

describe('config/screens', () => {
  it('provides configuration for all platforms and screens', () => {
    expect(APP_CONFIG.enabledScreens.home).toBe(true);
    expect(APP_CONFIG.enabledScreens.viewer).toBe(true);
    expect(APP_CONFIG.enabledScreens.about).toBe(true);
    expect(APP_CONFIG.enabledScreens.tool).toBe(true);

    expect(getInitialDestination('web')).toBe('/');
    expect(getInitialDestination('electron')).toBe('/');
    expect(getInitialDestination('android')).toBe('/');

    expect(getDefaultShellVisibility('web')).toBe(true);
    expect(getDefaultShellVisibility('electron')).toBe(true);
    expect(getDefaultShellVisibility('android')).toBe(true);
  });

  it('checks screen enabled status correctly across platforms', () => {
    expect(isScreenEnabled('home')).toBe(true);
    expect(isScreenEnabled('about')).toBe(true);
    expect(isScreenEnabled('tool')).toBe(true);
    // On web, embedded viewer screen is disabled in favor of native browser viewing
    expect(isScreenEnabled('viewer', 'web')).toBe(false);
    expect(isScreenEnabled('viewer', 'electron')).toBe(true);
    expect(isScreenEnabled('viewer', 'android')).toBe(true);
  });

  it('resolves valid destinations', () => {
    expect(resolveDestination('/', 'web')).toBe('/');
    // Web falls back to home when attempting to navigate to embedded /viewer
    expect(resolveDestination('/viewer', 'web')).toBe('/');
    expect(resolveDestination('/viewer', 'electron')).toBe('/viewer');
    expect(resolveDestination('/viewer', 'android')).toBe('/viewer');
    expect(resolveDestination('/about', 'android')).toBe('/about');
    expect(resolveDestination('/tool/merge', 'web')).toBe('/tool/merge');
    expect(resolveDestination('/tool/rotate', 'electron')).toBe('/tool/rotate');
    expect(resolveDestination('/tool/images-to-pdf', 'web')).toBe('/tool/images-to-pdf');
    expect(resolveDestination('/tool/compress', 'web')).toBe('/tool/compress');
  });

  it('safely falls back for unknown destinations, unlisted tools, and disabled/coming-soon tools', () => {
    expect(resolveDestination('/unknown-route', 'web')).toBe('/');
    expect(resolveDestination('/tool/non-existent-tool-xyz', 'web')).toBe('/');
    expect(resolveDestination('/tool/fake', 'android')).toBe('/');
    // Available tools resolve to their route
    expect(resolveDestination('/tool/split', 'electron')).toBe('/tool/split');
    // Coming soon tools cannot be opened through direct navigation
    expect(resolveDestination('/tool/protect', 'web')).toBe('/');
    expect(resolveDestination('/tool/unlock', 'android')).toBe('/');
  });

  it('supports configuring independent initial destinations per platform and safely falls back if initial destination is invalid', () => {
    // 1. Web configured to /about
    const origWeb = APP_CONFIG.initialDestinations.web;
    APP_CONFIG.initialDestinations.web = '/about';
    expect(getInitialDestination('web')).toBe('/about');
    expect(resolveDestination('/unknown-route', 'web')).toBe('/about');
    APP_CONFIG.initialDestinations.web = origWeb;

    // 2. Electron configured to /tool/merge
    const origElectron = APP_CONFIG.initialDestinations.electron;
    APP_CONFIG.initialDestinations.electron = '/tool/merge';
    expect(getInitialDestination('electron')).toBe('/tool/merge');
    expect(resolveDestination('/unknown-route', 'electron')).toBe('/tool/merge');
    APP_CONFIG.initialDestinations.electron = origElectron;

    // 3. Android configured to /about
    const origAndroid = APP_CONFIG.initialDestinations.android;
    APP_CONFIG.initialDestinations.android = '/about';
    expect(getInitialDestination('android')).toBe('/about');
    expect(resolveDestination('/unknown-route', 'android')).toBe('/about');
    APP_CONFIG.initialDestinations.android = origAndroid;

    // 4. Invalid configured initial destination safely resolves to '/'
    APP_CONFIG.initialDestinations.electron = '/tool/non-existent-xyz';
    expect(resolveDestination('/unknown-route', 'electron')).toBe('/');
    APP_CONFIG.initialDestinations.electron = origElectron;

    // 5. Defaults verified restored
    expect(getInitialDestination('web')).toBe('/');
    expect(getInitialDestination('electron')).toBe('/');
    expect(getInitialDestination('android')).toBe('/');
  });
});
