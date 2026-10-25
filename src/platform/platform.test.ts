import { describe, expect, it } from 'vitest';
import { getPlatformType, platform, uint8ArrayToBase64 } from './index';

describe('platform adapter', () => {
  it('exposes pickPdfFile, onFileOpened, and saveFile', () => {
    expect(typeof platform.pickPdfFile).toBe('function');
    expect(typeof platform.onFileOpened).toBe('function');
    expect(typeof platform.saveFile).toBe('function');
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

  it('accurately converts Uint8Array to base64 with chunked buffering', () => {
    const sample = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]); // "Hello World"
    const b64 = uint8ArrayToBase64(sample);
    expect(b64).toBe(btoa('Hello World'));

    // Test large buffer spanning multiple chunks (> 32KB)
    const large = new Uint8Array(40000);
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256;
    }
    const largeB64 = uint8ArrayToBase64(large);
    expect(typeof largeB64).toBe('string');
    expect(largeB64.length).toBeGreaterThan(0);
  });

  it('handles platform.saveFile gracefully in document environment', async () => {
    const sample = new Uint8Array([37, 80, 68, 70]); // %PDF
    expect(platform.saveFile).toBeDefined();
    await expect(platform.saveFile!(sample, 'test-doc.pdf', 'application/pdf')).resolves.not.toThrow();
  });
});
