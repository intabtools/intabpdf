import { describe, expect, it } from 'vitest';
import {
  applyCleanBw,
  applyGrayscale,
  calculateEffectiveDimensions,
  detectImageFormat,
  origToVis,
  processImageWithEdits,
  resolveDocumentAutoOrientation,
  validateAndNormalizeCrop,
  visToOrig,
} from './imageFilters';

describe('imageFilters', () => {
  describe('validateAndNormalizeCrop', () => {
    it('returns null for null, undefined, and non-numeric crops', () => {
      expect(validateAndNormalizeCrop(null)).toBeNull();
      expect(validateAndNormalizeCrop(undefined)).toBeNull();
      // @ts-expect-error test invalid shape
      expect(validateAndNormalizeCrop({ x: 'a', y: 0, w: 1, h: 1 })).toBeNull();
      expect(validateAndNormalizeCrop({ x: NaN, y: 0, w: 1, h: 1 })).toBeNull();
    });

    it('returns null for zero-sized or excessively small crops', () => {
      expect(validateAndNormalizeCrop({ x: 0, y: 0, w: 0, h: 0.5 })).toBeNull();
      expect(validateAndNormalizeCrop({ x: 0, y: 0, w: 0.5, h: 0.001 })).toBeNull();
      expect(validateAndNormalizeCrop({ x: 0, y: 0, w: -0.2, h: 0.5 })).toBeNull();
    });

    it('clamps out-of-bounds crops within [0, 1] range', () => {
      const crop = validateAndNormalizeCrop({ x: -0.1, y: 0.8, w: 1.5, h: 0.5 });
      expect(crop).not.toBeNull();
      expect(crop!.x).toBe(0);
      expect(crop!.w).toBeLessThanOrEqual(1);
      expect(crop!.y + crop!.h).toBeLessThanOrEqual(1);
    });

    it('preserves valid normalized crops', () => {
      const valid = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
      const res = validateAndNormalizeCrop(valid);
      expect(res).toEqual(valid);
    });
  });

  describe('Crop Coordinate Mapping across Rotations', () => {
    const testCrop = { x: 0.1, y: 0.2, w: 0.5, h: 0.3 };

    [0, 90, 180, 270].forEach((rot) => {
      it(`round-trips crop coordinates accurately for rotation ${rot}°`, () => {
        const orig = visToOrig(testCrop, rot);
        const backToVis = origToVis(orig, rot);

        expect(Math.abs(backToVis.x - testCrop.x)).toBeLessThan(1e-6);
        expect(Math.abs(backToVis.y - testCrop.y)).toBeLessThan(1e-6);
        expect(Math.abs(backToVis.w - testCrop.w)).toBeLessThan(1e-6);
        expect(Math.abs(backToVis.h - testCrop.h)).toBeLessThan(1e-6);
      });
    });
  });

  describe('calculateEffectiveDimensions', () => {
    it('returns original dimensions when unrotated and uncropped', () => {
      const dims = calculateEffectiveDimensions(1920, 1080, 0);
      expect(dims.width).toBe(1920);
      expect(dims.height).toBe(1080);
      expect(dims.isLandscape).toBe(true);
    });

    it('swaps dimensions when rotated 90° or 270°', () => {
      const r90 = calculateEffectiveDimensions(1920, 1080, 90);
      expect(r90.width).toBe(1080);
      expect(r90.height).toBe(1920);
      expect(r90.isLandscape).toBe(false);

      const r270 = calculateEffectiveDimensions(1920, 1080, 270);
      expect(r270.width).toBe(1080);
      expect(r270.height).toBe(1920);
      expect(r270.isLandscape).toBe(false);
    });

    it('correctly calculates effective dimensions for landscape cropped to portrait', () => {
      // 1920x1080 landscape image, crop width fraction = 0.3, height fraction = 1.0
      const dims = calculateEffectiveDimensions(1920, 1080, 0, { x: 0.3, y: 0, w: 0.3, h: 1.0 });
      expect(dims.width).toBe(576);
      expect(dims.height).toBe(1080);
      expect(dims.isLandscape).toBe(false); // Now portrait!
    });

    it('correctly calculates effective dimensions for portrait cropped to landscape', () => {
      // 1080x1920 portrait image, crop width fraction = 1.0, height fraction = 0.3
      const dims = calculateEffectiveDimensions(1080, 1920, 0, { x: 0, y: 0.3, w: 1.0, h: 0.3 });
      expect(dims.width).toBe(1080);
      expect(dims.height).toBe(576);
      expect(dims.isLandscape).toBe(true); // Now landscape!
    });
  });

  describe('resolveDocumentAutoOrientation', () => {
    it('resolves Landscape when majority of effective images are landscape', () => {
      const items = [
        { width: 1920, height: 1080, rotation: 0 }, // landscape
        { width: 1920, height: 1080, rotation: 0 }, // landscape
        { width: 1080, height: 1920, rotation: 0 }, // portrait
      ];
      expect(resolveDocumentAutoOrientation(items)).toBe('landscape');
    });

    it('resolves Portrait when majority of effective images are portrait', () => {
      const items = [
        { width: 1080, height: 1920, rotation: 0 }, // portrait
        { width: 1080, height: 1920, rotation: 0 }, // portrait
        { width: 1920, height: 1080, rotation: 0 }, // landscape
      ];
      expect(resolveDocumentAutoOrientation(items)).toBe('portrait');
    });

    it('accounts for cropping in majority vote (landscape cropped to portrait)', () => {
      const items = [
        // Landscape image cropped into a tall portrait shape
        { width: 1920, height: 1080, rotation: 0, crop: { x: 0.3, y: 0, w: 0.3, h: 1.0 } }, // eff: 576x1080 (portrait)
        { width: 1080, height: 1920, rotation: 0 }, // portrait
        { width: 1920, height: 1080, rotation: 0 }, // landscape
      ];
      // 2 portrait vs 1 landscape
      expect(resolveDocumentAutoOrientation(items)).toBe('portrait');
    });

    it('resolves to Portrait on equal landscape and portrait count (tie-breaker)', () => {
      const items = [
        { width: 1920, height: 1080, rotation: 0 }, // landscape
        { width: 1080, height: 1920, rotation: 0 }, // portrait
      ];
      expect(resolveDocumentAutoOrientation(items)).toBe('portrait');
    });

    it('guarantees reordering invariance (reordering items does not change the result)', () => {
      const itemsA = [
        { width: 1920, height: 1080, rotation: 0 },
        { width: 1080, height: 1920, rotation: 0 },
        { width: 800, height: 1200, rotation: 0 },
      ];
      const itemsB = [...itemsA].reverse();

      expect(resolveDocumentAutoOrientation(itemsA)).toBe('portrait');
      expect(resolveDocumentAutoOrientation(itemsB)).toBe('portrait');
    });
  });

  describe('Clean B&W Filter Content Preservation', () => {
    function createMockImageData(width: number, height: number, fillRgb: [number, number, number]): ImageData {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = fillRgb[0];
        data[i + 1] = fillRgb[1];
        data[i + 2] = fillRgb[2];
        data[i + 3] = 255;
      }
      return {
        width,
        height,
        data,
        colorSpace: 'srgb',
      } as ImageData;
    }

    it('converts to grayscale correctly', () => {
      // Pure red: 0.299 * 255 ~= 76
      const img = createMockImageData(4, 4, [255, 0, 0]);
      applyGrayscale(img);
      expect(img.data[0]).toBe(76);
      expect(img.data[1]).toBe(76);
      expect(img.data[2]).toBe(76);
    });

    it('preserves faint pencil marks and does not whiten them out', () => {
      // 64x64 image: off-white paper (Y = 180) with a faint pencil stroke in the center (Y = 160, delta = 20)
      const width = 64;
      const height = 64;
      const img = createMockImageData(width, height, [180, 180, 180]);

      // Add faint pencil mark at row 32, col 32
      const pencilIdx = (32 * width + 32) * 4;
      img.data[pencilIdx] = 160;
      img.data[pencilIdx + 1] = 160;
      img.data[pencilIdx + 2] = 160;

      applyCleanBw(img);

      // The pencil pixel must be darkened (enhanced contrast), NOT bleached/whitened!
      const pencilOut = img.data[pencilIdx];
      expect(pencilOut).toBeLessThanOrEqual(140);
      expect(pencilOut).toBeLessThan(180);

      // The paper background away from the stroke should be brightened toward clean white
      const paperIdx = (5 * width + 5) * 4;
      expect(img.data[paperIdx]).toBeGreaterThanOrEqual(230);
    });

    it('preserves dark printed text and receipt thermal print', () => {
      const width = 64;
      const height = 64;
      const img = createMockImageData(width, height, [200, 200, 200]);

      // Black text (Y = 30)
      const textIdx = (32 * width + 32) * 4;
      img.data[textIdx] = 30;
      img.data[textIdx + 1] = 30;
      img.data[textIdx + 2] = 30;

      applyCleanBw(img);

      // Text must remain crisp dark black
      expect(img.data[textIdx]).toBeLessThanOrEqual(25);
    });

    it('brightens paper under uneven lighting without blotches', () => {
      const width = 64;
      const height = 64;
      const img = createMockImageData(width, height, [150, 150, 150]);

      // Create a smooth lighting gradient across rows (from 140 to 210)
      for (let y = 0; y < height; y++) {
        const rowVal = Math.round(140 + (y / height) * 70);
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          img.data[idx] = rowVal;
          img.data[idx + 1] = rowVal;
          img.data[idx + 2] = rowVal;
        }
      }

      applyCleanBw(img);

      // Verify that after filtering, paper across the gradient is brightened toward white
      const topPaper = img.data[0];
      const bottomPaper = img.data[(63 * width + 63) * 4];
      expect(topPaper).toBeGreaterThanOrEqual(220);
      expect(bottomPaper).toBeGreaterThanOrEqual(240);
    });
  });

  describe('detectImageFormat', () => {
    it('detects JPEG format from magic bytes', () => {
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(detectImageFormat(jpegBytes)).toBe('jpeg');
    });

    it('detects PNG format from magic bytes', () => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectImageFormat(pngBytes)).toBe('png');
    });

    it('detects WebP format from RIFF...WEBP header', () => {
      const webpBytes = new Uint8Array([
        0x52, 0x49, 0x46, 0x46,
        0x00, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50,
      ]);
      expect(detectImageFormat(webpBytes)).toBe('webp');
    });

    it('returns unknown for unrecognizable headers', () => {
      const unknownBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      expect(detectImageFormat(unknownBytes)).toBe('unknown');
    });
  });

  describe('processImageWithEdits & Shrink Behavior', () => {
    it('bypasses canvas and returns original bytes when no operations and shrink is false', async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const res = await processImageWithEdits(original, 'test.jpg', {
        rotation: 0,
        crop: undefined,
        filter: 'none',
        shrink: false,
      });
      expect(res).toBe(original); // Exact same Uint8Array reference
    });

    it('preserves original bytes when shrink alone is requested and image is within maxDimension', async () => {
      // 1x1 transparent PNG:
      // 89 50 4E 47 0D 0A 1A 0A ...
      const png1x1 = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);

      // If runtime has createImageBitmap / Image, fast bailout returns exact original bytes
      const res = await processImageWithEdits(png1x1, 'small.png', {
        rotation: 0,
        crop: undefined,
        filter: 'none',
        shrink: true,
        maxDimension: 1920,
      });

      expect(res).toBe(png1x1); // Exact reference preserved!
    });
  });
});
