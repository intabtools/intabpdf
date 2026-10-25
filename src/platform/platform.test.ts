import { describe, expect, it } from 'vitest';
import { getPlatformType, platform } from './index';

describe('platform adapter', () => {
  it('exposes pickPdfFile and onFileOpened', () => {
    expect(typeof platform.pickPdfFile).toBe('function');
    expect(typeof platform.onFileOpened).toBe('function');
  });

  it('safely handles onFileOpened when window.intab is not present', () => {
    const unsubscribe = platform.onFileOpened(() => {});
    expect(typeof unsubscribe).toBe('function');
    // Calling unsubscribe should not throw
    expect(() => unsubscribe()).not.toThrow();
  });

  it('detects runtime platform via getPlatformType', () => {
    const p = getPlatformType();
    expect(['android', 'electron', 'web']).toContain(p);
  });
});
