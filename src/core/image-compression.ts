// Pure utility functions for image downsampling, JPEG recompression, predictor reversal, and raster conversion.

/**
 * Undoes PNG predictors (filter types 10-15 in PDF specification).
 * Predictor 10 = PNG None
 * Predictor 11 = PNG Sub
 * Predictor 12 = PNG Up
 * Predictor 13 = PNG Average
 * Predictor 14 = PNG Paeth
 * Predictor 15 = PNG Optimum (any of the above per scanline)
 */
export function undoPngPredictor(
  encoded: Uint8Array,
  width: number,
  height: number,
  colors: number = 3,
  bitsPerComponent: number = 8
): Uint8Array {
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowBytes = Math.ceil((width * colors * bitsPerComponent) / 8);
  const stride = rowBytes + 1; // 1-byte filter tag + row data
  const output = new Uint8Array(width * height * bytesPerPixel);

  function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let r = 0; r < height; r++) {
    const rowStart = r * stride;
    if (rowStart >= encoded.length) break;
    const filterType = encoded[rowStart];
    const outRowStart = r * rowBytes;
    const priorRowStart = (r - 1) * rowBytes;

    for (let c = 0; c < rowBytes; c++) {
      const rawByte = rowStart + 1 + c < encoded.length ? encoded[rowStart + 1 + c] : 0;
      const left = c >= bytesPerPixel ? output[outRowStart + c - bytesPerPixel] : 0;
      const up = r > 0 ? output[priorRowStart + c] : 0;
      const upLeft = r > 0 && c >= bytesPerPixel ? output[priorRowStart + c - bytesPerPixel] : 0;

      let val: number;
      switch (filterType) {
        case 0: // None
          val = rawByte;
          break;
        case 1: // Sub
          val = (rawByte + left) & 0xff;
          break;
        case 2: // Up
          val = (rawByte + up) & 0xff;
          break;
        case 3: // Average
          val = (rawByte + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4: // Paeth
          val = (rawByte + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          val = rawByte;
          break;
      }
      output[outRowStart + c] = val;
    }
  }
  return output;
}

/**
 * Undoes TIFF Predictor 2 (horizontal difference predictor).
 */
export function undoTiffPredictor(
  encoded: Uint8Array,
  width: number,
  height: number,
  colors: number = 3,
  bitsPerComponent: number = 8
): Uint8Array {
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowBytes = Math.ceil((width * colors * bitsPerComponent) / 8);
  const output = new Uint8Array(width * height * bytesPerPixel);

  for (let r = 0; r < height; r++) {
    const rowStart = r * rowBytes;
    for (let c = 0; c < rowBytes; c++) {
      const rawByte = rowStart + c < encoded.length ? encoded[rowStart + c] : 0;
      const left = c >= bytesPerPixel ? output[rowStart + c - bytesPerPixel] : 0;
      output[rowStart + c] = (rawByte + left) & 0xff;
    }
  }
  return output;
}

/**
 * Recompresses raw raster bitmap pixels (RGB or Grayscale) into high-efficiency JPEG bytes.
 * Handles downsampling and quality adjustment using Canvas / OffscreenCanvas.
 */
export async function recompressRasterPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  colors: number, // 3 for RGB, 1 for Gray, 4 for CMYK
  quality: number,
  maxDimension?: number,
  isCmyk?: boolean
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (width <= 0 || height <= 0 || pixels.byteLength === 0) return null;

  let targetWidth = width;
  let targetHeight = height;
  if (maxDimension && (targetWidth > maxDimension || targetHeight > maxDimension)) {
    const scale = Math.min(maxDimension / targetWidth, maxDimension / targetHeight);
    targetWidth = Math.max(1, Math.round(targetWidth * scale));
    targetHeight = Math.max(1, Math.round(targetHeight * scale));
  }

  // Construct RGBA buffer for 2D canvas putImageData
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (colors === 3) {
    for (let i = 0, j = 0; i < pixels.length && j < rgba.length; i += 3, j += 4) {
      rgba[j] = pixels[i];
      rgba[j + 1] = pixels[i + 1];
      rgba[j + 2] = pixels[i + 2];
      rgba[j + 3] = 255;
    }
  } else if (colors === 1) {
    for (let i = 0, j = 0; i < pixels.length && j < rgba.length; i++, j += 4) {
      const g = pixels[i];
      rgba[j] = g;
      rgba[j + 1] = g;
      rgba[j + 2] = g;
      rgba[j + 3] = 255;
    }
  } else if (colors === 4 && isCmyk) {
    // Standard CMYK subtractive color conversion to sRGB
    for (let i = 0, j = 0; i < pixels.length && j < rgba.length; i += 4, j += 4) {
      const c = pixels[i] / 255;
      const m = pixels[i + 1] / 255;
      const y = pixels[i + 2] / 255;
      const k = pixels[i + 3] / 255;
      rgba[j] = Math.round(255 * (1 - c) * (1 - k));
      rgba[j + 1] = Math.round(255 * (1 - m) * (1 - k));
      rgba[j + 2] = Math.round(255 * (1 - y) * (1 - k));
      rgba[j + 3] = 255;
    }
  } else {
    // 4 components (RGBA)
    for (let i = 0, j = 0; i < pixels.length && j < rgba.length; i += 4, j += 4) {
      rgba[j] = pixels[i];
      rgba[j + 1] = pixels[i + 1];
      rgba[j + 2] = pixels[i + 2];
      rgba[j + 3] = pixels[i + 3];
    }
  }

  // 1. OffscreenCanvas (Modern browsers, Workers, Electron)
  if (typeof OffscreenCanvas !== 'undefined' && typeof ImageData !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(rgba, width, height);
        ctx.putImageData(imgData, 0, 0);

        let finalCanvas: OffscreenCanvas = canvas;
        if (targetWidth !== width || targetHeight !== height) {
          const downCanvas = new OffscreenCanvas(targetWidth, targetHeight);
          const downCtx = downCanvas.getContext('2d');
          if (downCtx) {
            downCtx.imageSmoothingEnabled = true;
            downCtx.imageSmoothingQuality = 'high';
            downCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
            finalCanvas = downCanvas;
          }
        }

        const blob = await finalCanvas.convertToBlob({ type: 'image/jpeg', quality });
        const arrayBuffer = await blob.arrayBuffer();
        return {
          bytes: new Uint8Array(arrayBuffer),
          width: targetWidth,
          height: targetHeight,
        };
      }
    } catch {
      // Fall through to DOM canvas
    }
  }

  // 2. DOM Canvas (Browser main thread)
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        let imgData: ImageData;
        if (typeof ImageData !== 'undefined') {
          imgData = new ImageData(rgba, width, height);
        } else {
          imgData = ctx.createImageData(width, height);
          imgData.data.set(rgba);
        }
        ctx.putImageData(imgData, 0, 0);

        let finalCanvas: HTMLCanvasElement = canvas;
        if (targetWidth !== width || targetHeight !== height) {
          const downCanvas = document.createElement('canvas');
          downCanvas.width = targetWidth;
          downCanvas.height = targetHeight;
          const downCtx = downCanvas.getContext('2d');
          if (downCtx) {
            downCtx.imageSmoothingEnabled = true;
            downCtx.imageSmoothingQuality = 'high';
            downCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
            finalCanvas = downCanvas;
          }
        }

        const blob = await new Promise<Blob | null>((resolve) => {
          finalCanvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
        });

        if (blob) {
          const arrayBuffer = await blob.arrayBuffer();
          return {
            bytes: new Uint8Array(arrayBuffer),
            width: targetWidth,
            height: targetHeight,
          };
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

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
      try {
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
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
            resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
          }
        } else if (typeof document !== 'undefined') {
          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
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
      } finally {
        // ALWAYS close bitmap to release GPU and native memory immediately, preventing OOM on Android
        if (typeof bitmap.close === 'function') {
          bitmap.close();
        }
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

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
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
