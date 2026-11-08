// Browser/UI layer utility for resizing and recompressing oversized images.
// Placed in src/tools/modules to preserve src/core purity (zero DOM/Canvas in core).

export interface ShrinkImageOptions {
  maxDimension?: number;
  quality?: number;
}

/**
 * Detects image format from leading magic bytes.
 */
export function detectFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | 'unknown' {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return 'unknown';
}

/**
 * Calculates proportional target dimensions preserving aspect ratio.
 * Never upscales smaller images.
 */
export function calculateTargetDimensions(
  width: number,
  height: number,
  maxDimension = 1920
): { targetWidth: number; targetHeight: number; shouldScale: boolean } {
  if (width <= maxDimension && height <= maxDimension) {
    return { targetWidth: width, targetHeight: height, shouldScale: false };
  }
  const scale = Math.min(maxDimension / width, maxDimension / height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  return { targetWidth, targetHeight, shouldScale: true };
}

/**
 * Compares original and processed byte buffers, returning the original if the
 * processed output is larger than or equal to the original.
 */
export function selectSmallerBytes(original: Uint8Array, processed: Uint8Array): Uint8Array {
  return processed.byteLength < original.byteLength ? processed : original;
}

/**
 * Resizes and recompresses an image if either dimension exceeds maxDimension (default: 1920px).
 * Preserves aspect ratio, avoids enlargement of smaller images, and returns original bytes
 * if downsampling is not needed, not supported, or if processed output is not smaller than original.
 */
export async function shrinkImageIfNeeded(
  imageBytes: Uint8Array,
  _fileName: string,
  options?: ShrinkImageOptions
): Promise<Uint8Array> {
  const maxDimension = options?.maxDimension ?? 1920;
  const quality = options?.quality ?? 0.85;

  if (typeof Blob === 'undefined' || typeof createImageBitmap === 'undefined') {
    return imageBytes;
  }

  const format = detectFormat(imageBytes);
  if (format === 'unknown') {
    return imageBytes;
  }

  const mimeType =
    format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'image/webp';

  try {
    const blob = new Blob([imageBytes as BlobPart], { type: mimeType });
    const bitmap = await createImageBitmap(blob);

    try {
      const { targetWidth, targetHeight, shouldScale } = calculateTargetDimensions(
        bitmap.width,
        bitmap.height,
        maxDimension
      );

      // If image is already within max bounds, leave it untouched
      if (!shouldScale) {
        return imageBytes;
      }

      let resultBlob: Blob | null = null;

      // Quality parameter is only valid for lossy formats (JPEG/WebP); PNG is lossless in HTML Canvas
      const encodeQuality = format === 'jpeg' || format === 'webp' ? quality : undefined;

      // 1. OffscreenCanvas (modern browsers & workers)
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
          resultBlob = await canvas.convertToBlob({
            type: mimeType,
            quality: encodeQuality,
          });
        }
      } else if (typeof document !== 'undefined') {
        // 2. DOM Canvas fallback
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
          resultBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((b) => resolve(b), mimeType, encodeQuality);
          });
        }
      }

      if (resultBlob) {
        const buffer = await resultBlob.arrayBuffer();
        const processedBytes = new Uint8Array(buffer);
        // Only return processed bytes if they actually reduce file size
        return selectSmallerBytes(imageBytes, processedBytes);
      }
    } finally {
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  } catch {
    // If decoding or canvas downsampling fails, safely fall back to original bytes
  }

  return imageBytes;
}
