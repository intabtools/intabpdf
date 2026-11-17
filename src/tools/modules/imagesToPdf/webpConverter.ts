// Browser/tool adapter layer utility for converting WebP images to PNG.
// Placed in src/tools/modules to preserve src/core purity (zero DOM/Canvas in core).

/**
 * Checks leading magic bytes to identify whether an image is in WebP format.
 */
export function isWebpImage(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46 && // 'F'
    bytes[8] === 0x57 && // 'W'
    bytes[9] === 0x45 && // 'E'
    bytes[10] === 0x42 && // 'B'
    bytes[11] === 0x50 // 'P'
  );
}

/**
 * Converts a WebP byte buffer to PNG format using standard HTML5 / OffscreenCanvas APIs.
 * Supports Web Workers (OffscreenCanvas) and DOM environments (HTMLCanvasElement & Image fallback).
 */
export async function convertWebpToPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof Blob === 'undefined') {
    throw new Error(
      'WebP conversion is not supported in this runtime environment (requires Blob and Canvas APIs).'
    );
  }

  const blob = new Blob([bytes as BlobPart], { type: 'image/webp' });

  // 1. Try modern createImageBitmap path (works in workers with OffscreenCanvas, and in modern browsers)
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(blob);
      let pngBlob: Blob | null = null;

      try {
        if (typeof OffscreenCanvas !== 'undefined') {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            pngBlob = await canvas.convertToBlob({ type: 'image/png' });
          }
        } else if (typeof document !== 'undefined') {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            pngBlob = await new Promise<Blob | null>((resolve) => {
              canvas.toBlob((b) => resolve(b), 'image/png');
            });
          }
        }
      } finally {
        if (typeof bitmap.close === 'function') {
          bitmap.close();
        }
      }

      if (pngBlob) {
        const arrayBuffer = await pngBlob.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      }
    } catch {
      // Fall through to DOM Image fallback if available
    }
  }

  // 2. DOM fallback: Image element + HTMLCanvasElement
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof Image !== 'undefined') {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load WebP image via Image element.'));
        image.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get 2D canvas context.');
      ctx.drawImage(img, 0, 0);

      const pngBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });

      if (!pngBlob) throw new Error('Failed to convert canvas to PNG blob.');
      const arrayBuffer = await pngBlob.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  throw new Error(
    'WebP conversion is not supported in this runtime environment (requires OffscreenCanvas or DOM Canvas).'
  );
}
