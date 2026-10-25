// Pure utility functions for image downsampling and JPEG recompression using Canvas and ImageBitmap.

/**
 * Recompresses raw JPEG bytes using HTML5 / OffscreenCanvas APIs.
 * Supports downsampling dimensions and variable JPEG compression quality.
 * Returns null if the current environment lacks canvas support or image decoding fails.
 */
export async function recompressJpegBytes(
  jpegBytes: Uint8Array,
  quality: number,
  maxDimension?: number
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (typeof Blob === 'undefined') return null;

  const blob = new Blob([jpegBytes as BlobPart], { type: 'image/jpeg' });

  // 1. Modern createImageBitmap path (works in Web Workers with OffscreenCanvas, and modern browsers)
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(blob);
      let targetWidth = bitmap.width;
      let targetHeight = bitmap.height;

      if (maxDimension && (targetWidth > maxDimension || targetHeight > maxDimension)) {
        const scale = Math.min(maxDimension / targetWidth, maxDimension / targetHeight);
        targetWidth = Math.max(1, Math.round(targetWidth * scale));
        targetHeight = Math.max(1, Math.round(targetHeight * scale));
      }

      let resultBlob: Blob | null = null;

      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
          resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        }
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
          resultBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
          });
        }
      }

      if (resultBlob) {
        const arrayBuffer = await resultBlob.arrayBuffer();
        return {
          bytes: new Uint8Array(arrayBuffer),
          width: targetWidth,
          height: targetHeight,
        };
      }
    } catch {
      // Fall through to DOM fallback or return null
    }
  }

  // 2. DOM fallback using HTMLImageElement
  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof Image !== 'undefined' &&
    typeof URL !== 'undefined'
  ) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load JPEG image'));
        image.src = url;
      });

      let targetWidth = img.naturalWidth || img.width;
      let targetHeight = img.naturalHeight || img.height;

      if (maxDimension && (targetWidth > maxDimension || targetHeight > maxDimension)) {
        const scale = Math.min(maxDimension / targetWidth, maxDimension / targetHeight);
        targetWidth = Math.max(1, Math.round(targetWidth * scale));
        targetHeight = Math.max(1, Math.round(targetHeight * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const resultBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
      });

      if (!resultBlob) return null;
      const arrayBuffer = await resultBlob.arrayBuffer();
      return {
        bytes: new Uint8Array(arrayBuffer),
        width: targetWidth,
        height: targetHeight,
      };
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return null;
}
