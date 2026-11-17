// Browser/UI layer utilities for client-side image editing (rotation, crop, filters)
// Strictly isolated to src/tools/modules to preserve src/core purity (zero DOM/Canvas in core).

export interface NormalizedRect {
  x: number; // 0.0 to 1.0 (left fraction)
  y: number; // 0.0 to 1.0 (top fraction)
  w: number; // 0.0 to 1.0 (width fraction)
  h: number; // 0.0 to 1.0 (height fraction)
}

export type DocumentFilter = 'none' | 'grayscale' | 'clean-bw';

/**
 * Validates, clamps, and normalizes a crop rectangle.
 * Safely handles invalid, NaN, negative, zero-sized, and out-of-bounds coordinates.
 * Returns null if the crop is not valid or too small to be meaningful.
 */
export function validateAndNormalizeCrop(
  crop: NormalizedRect | undefined | null,
  minSize = 0.02
): NormalizedRect | null {
  if (!crop) return null;

  const { x, y, w, h } = crop;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number' ||
    isNaN(x) ||
    isNaN(y) ||
    isNaN(w) ||
    isNaN(h) ||
    w < minSize ||
    h < minSize
  ) {
    return null;
  }

  const clampedX = Math.max(0, Math.min(1 - minSize, x));
  const clampedY = Math.max(0, Math.min(1 - minSize, y));
  const clampedW = Math.max(minSize, Math.min(1 - clampedX, w));
  const clampedH = Math.max(minSize, Math.min(1 - clampedY, h));

  return {
    x: clampedX,
    y: clampedY,
    w: clampedW,
    h: clampedH,
  };
}

/**
 * Maps normalized crop coordinates from visible rotated preview space to original image space.
 */
export function visToOrig(cropVis: NormalizedRect, rotCw: number): NormalizedRect {
  const norm = validateAndNormalizeCrop(cropVis);
  if (!norm) return { x: 0, y: 0, w: 1, h: 1 };

  const { x, y, w, h } = norm;
  const rot = (((rotCw || 0) % 360) + 360) % 360;

  switch (rot) {
    case 90: // 90° CW: origX = visY, origY = 1 - visX - visW
      return { x: y, y: 1 - x - w, w: h, h: w };
    case 180: // 180° CW: origX = 1 - visX - visW, origY = 1 - visY - visH
      return { x: 1 - x - w, y: 1 - y - h, w, h };
    case 270: // 270° CW: origX = 1 - visY - visH, origY = visX
      return { x: 1 - y - h, y: x, w: h, h: w };
    case 0:
    default:
      return { x, y, w, h };
  }
}

/**
 * Maps normalized crop coordinates from original image space to visible rotated preview space.
 */
export function origToVis(cropOrig: NormalizedRect, rotCw: number): NormalizedRect {
  const norm = validateAndNormalizeCrop(cropOrig);
  if (!norm) return { x: 0, y: 0, w: 1, h: 1 };

  const { x, y, w, h } = norm;
  const rot = (((rotCw || 0) % 360) + 360) % 360;

  switch (rot) {
    case 90:
      return { x: 1 - y - h, y: x, w: h, h: w };
    case 180:
      return { x: 1 - x - w, y: 1 - y - h, w, h };
    case 270:
      return { x: y, y: 1 - x - w, w: h, h: w };
    case 0:
    default:
      return { x, y, w, h };
  }
}

/**
 * Calculates effective pixel dimensions of an image after rotation and optional cropping.
 */
export function calculateEffectiveDimensions(
  origWidth: number,
  origHeight: number,
  rotCw = 0,
  cropNorm?: NormalizedRect | null
): { width: number; height: number; isLandscape: boolean } {
  const rot = (((rotCw || 0) % 360) + 360) % 360;
  const isRotated90or270 = rot === 90 || rot === 270;

  const visWidth = isRotated90or270 ? origHeight : origWidth;
  const visHeight = isRotated90or270 ? origWidth : origHeight;

  const validCrop = validateAndNormalizeCrop(cropNorm);
  if (!validCrop) {
    return {
      width: Math.max(1, Math.round(visWidth)),
      height: Math.max(1, Math.round(visHeight)),
      isLandscape: visWidth > visHeight,
    };
  }

  const effWidth = Math.max(1, Math.round(visWidth * validCrop.w));
  const effHeight = Math.max(1, Math.round(visHeight * validCrop.h));

  return {
    width: effWidth,
    height: effHeight,
    isLandscape: effWidth > effHeight,
  };
}

/**
 * Resolves a single document-wide orientation using commutative majority vote.
 * Reordering images is guaranteed not to change the outcome. Equal count resolves to portrait.
 */
export function resolveDocumentAutoOrientation(
  items: Array<{
    width: number;
    height: number;
    rotation?: number;
    crop?: NormalizedRect | null;
  }>
): 'portrait' | 'landscape' {
  let landscapeCount = 0;
  let portraitCount = 0;

  for (const item of items) {
    const { isLandscape } = calculateEffectiveDimensions(
      item.width,
      item.height,
      item.rotation || 0,
      item.crop
    );
    if (isLandscape) {
      landscapeCount++;
    } else {
      portraitCount++;
    }
  }

  return landscapeCount > portraitCount ? 'landscape' : 'portrait';
}

/**
 * Converts ImageData to standard grayscale using perceptual luminance weights.
 */
export function applyGrayscale(data: ImageData): void {
  const pixels = data.data;
  const len = pixels.length;

  for (let i = 0; i < len; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    pixels[i] = y;
    pixels[i + 1] = y;
    pixels[i + 2] = y;
  }
}

/**
 * Conservative, content-preserving Clean B&W document filter.
 * Uses fast 2-pass local box filtering to estimate paper background,
 * gently brightening paper without bleaching faint pencil writing or thermal receipt print.
 */
export function applyCleanBw(data: ImageData): void {
  const { width, height } = data;
  const pixels = data.data;
  const totalPixels = width * height;

  // Step 1: Extract luminance map
  const lum = new Uint8Array(totalPixels);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    lum[p] = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
  }

  // Step 2: Estimate local paper background using 2-pass running box filter
  const radius = Math.max(8, Math.min(32, Math.floor(Math.min(width, height) / 4)));
  const bg = new Uint8Array(totalPixels);
  const temp = new Uint8Array(totalPixels);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    let count = 0;
    for (let x = 0; x < Math.min(radius, width); x++) {
      sum += lum[row + x];
      count++;
    }
    for (let x = 0; x < width; x++) {
      const addIdx = x + radius;
      if (addIdx < width) {
        sum += lum[row + addIdx];
        count++;
      }
      const remIdx = x - radius - 1;
      if (remIdx >= 0) {
        sum -= lum[row + remIdx];
        count--;
      }
      temp[row + x] = Math.round(sum / count);
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < Math.min(radius, height); y++) {
      sum += temp[y * width + x];
      count++;
    }
    for (let y = 0; y < height; y++) {
      const addIdx = y + radius;
      if (addIdx < height) {
        sum += temp[addIdx * width + x];
        count++;
      }
      const remIdx = y - radius - 1;
      if (remIdx >= 0) {
        sum -= temp[remIdx * width + x];
        count--;
      }
      bg[y * width + x] = Math.round(sum / count);
    }
  }

  // Step 3: Apply conservative tone mapping
  for (let i = 0; i < totalPixels; i++) {
    const p = lum[i];
    const b = bg[i];
    const delta = b - p;

    let out: number;
    if (delta <= 12) {
      // Paper background: gently brighten toward clean white
      out = Math.min(255, Math.round(p + (255 - b) * 0.85));
    } else {
      // Writing or ink: progressively boost contrast to darken
      out = Math.max(0, Math.min(255, Math.round(p - (delta - 12) * 2.5)));
    }

    const idx = i * 4;
    pixels[idx] = out;
    pixels[idx + 1] = out;
    pixels[idx + 2] = out;
  }
}

export interface ProcessImageOptions {
  rotation?: number; // 0, 90, 180, 270 (clockwise)
  crop?: NormalizedRect;
  filter?: DocumentFilter;
  shrink?: boolean;
  maxDimension?: number;
  quality?: number;
}

/**
 * Detects standard image formats from file magic headers.
 */
export function detectImageFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | 'unknown' {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
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
 * Single-pass client-side Canvas processor for applying crop, rotation, document filters,
 * and optional downsampling. Only runs if transformations are actually required.
 */
export async function processImageWithEdits(
  bytes: Uint8Array,
  _fileName: string,
  options: ProcessImageOptions = {}
): Promise<Uint8Array> {
  const rot = (((options.rotation || 0) % 360) + 360) % 360;
  const validCrop = validateAndNormalizeCrop(options.crop);
  const filter = options.filter ?? 'none';
  const shouldShrink = Boolean(options.shrink);

  // If no transforms, filters, or shrink are requested, return original bytes directly
  if (rot === 0 && !validCrop && filter === 'none' && !shouldShrink) {
    return bytes;
  }

  if (typeof Blob === 'undefined' || (typeof createImageBitmap === 'undefined' && typeof Image === 'undefined')) {
    return bytes;
  }

  // Decode image
  let imageSource: ImageBitmap | HTMLImageElement;
  let origWidth: number;
  let origHeight: number;

  const blob = new Blob([bytes as BlobPart]);

  if (typeof createImageBitmap !== 'undefined') {
    imageSource = await createImageBitmap(blob);
    origWidth = imageSource.width;
    origHeight = imageSource.height;
  } else {
    imageSource = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
    origWidth = imageSource.width;
    origHeight = imageSource.height;
  }

  // Fast bailout: if only shrinking was requested and the image is already within maxDimension,
  // return original bytes immediately to avoid unnecessary recompression and preserve format.
  const maxDim = options.maxDimension ?? 1920;
  if (rot === 0 && !validCrop && filter === 'none' && shouldShrink && origWidth <= maxDim && origHeight <= maxDim) {
    if ('close' in imageSource && typeof imageSource.close === 'function') {
      imageSource.close();
    }
    return bytes;
  }

  try {
    // 1. Calculate crop in original image pixel space
    let cropX = 0;
    let cropY = 0;
    let cropW = origWidth;
    let cropH = origHeight;

    if (validCrop) {
      // Convert visible rotated crop to original coordinates
      const origCrop = visToOrig(validCrop, rot);
      cropX = Math.round(origCrop.x * origWidth);
      cropY = Math.round(origCrop.y * origHeight);
      cropW = Math.max(1, Math.round(origCrop.w * origWidth));
      cropH = Math.max(1, Math.round(origCrop.h * origHeight));
    }

    // 2. Visible unscaled dimensions after rotation
    const isRotated90or270 = rot === 90 || rot === 270;
    let targetWidth = isRotated90or270 ? cropH : cropW;
    let targetHeight = isRotated90or270 ? cropW : cropH;

    // 3. Optional downsampling (shrink large images)
    if (shouldShrink) {
      if (targetWidth > maxDim || targetHeight > maxDim) {
        const scale = Math.min(maxDim / targetWidth, maxDim / targetHeight);
        targetWidth = Math.max(1, Math.round(targetWidth * scale));
        targetHeight = Math.max(1, Math.round(targetHeight * scale));
      }
    }

    // 4. Create canvas and execute single-pass draw
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(targetWidth, targetHeight);
      ctx = canvas.getContext('2d');
    } else {
      canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx = canvas.getContext('2d');
    }

    if (!ctx) return bytes;

    ctx.save();
    // Position context origin and rotate
    if (rot === 90) {
      ctx.translate(targetWidth, 0);
      ctx.rotate((90 * Math.PI) / 180);
    } else if (rot === 180) {
      ctx.translate(targetWidth, targetHeight);
      ctx.rotate((180 * Math.PI) / 180);
    } else if (rot === 270) {
      ctx.translate(0, targetHeight);
      ctx.rotate((270 * Math.PI) / 180);
    }

    // Draw the cropped sub-rectangle from original image into target canvas
    const drawW = isRotated90or270 ? targetHeight : targetWidth;
    const drawH = isRotated90or270 ? targetWidth : targetHeight;
    ctx.drawImage(imageSource, cropX, cropY, cropW, cropH, 0, 0, drawW, drawH);
    ctx.restore();

    // 5. Apply document filter if requested
    if (filter === 'grayscale') {
      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      applyGrayscale(imgData);
      ctx.putImageData(imgData, 0, 0);
    } else if (filter === 'clean-bw') {
      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      applyCleanBw(imgData);
      ctx.putImageData(imgData, 0, 0);
    }

    // 6. Export to byte buffer, preserving format and transparency
    const inputFormat = detectImageFormat(bytes);
    const quality = options.quality ?? 0.92;
    // PNG format is preserved for PNG inputs or clean-bw filter to retain alpha transparency
    const exportMime = (filter === 'clean-bw' || inputFormat === 'png') ? 'image/png' : 'image/jpeg';

    let resultBlob: Blob;
    if (canvas instanceof OffscreenCanvas) {
      resultBlob = await canvas.convertToBlob({
        type: exportMime,
        quality: exportMime === 'image/jpeg' ? quality : undefined,
      });
    } else {
      resultBlob = await new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('Canvas export returned null blob.'));
          },
          exportMime,
          exportMime === 'image/jpeg' ? quality : undefined
        );
      });
    }

    const arrayBuffer = await resultBlob.arrayBuffer();
    const resultBytes = new Uint8Array(arrayBuffer);

    // If shrinking was the ONLY operation and the processed result is not smaller,
    // retain the original bytes to prevent file size inflation.
    // Explicit user transformations (rotation, crop, filter) are NEVER discarded.
    if (rot === 0 && !validCrop && filter === 'none' && shouldShrink && resultBytes.byteLength >= bytes.byteLength) {
      return bytes;
    }

    return resultBytes;
  } finally {
    if ('close' in imageSource && typeof imageSource.close === 'function') {
      imageSource.close();
    }
  }
}
