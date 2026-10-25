// Pure core operation for converting one or more images into a single valid PDF document.
import { PDFDocument } from 'pdf-lib';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'unknown';
export type PageSizing = 'fit' | 'a4';
export type MarginPreset = 'none' | 'small' | 'standard';

export interface InputImage {
  name: string;
  bytes: Uint8Array;
}

export interface ImagesToPdfOptions {
  pageSizing?: PageSizing;
  margin?: MarginPreset;
}

// Standard A4 dimensions in PDF points (72 points per inch)
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const MARGIN_POINTS: Record<MarginPreset, number> = {
  none: 0,
  small: 18,     // 0.25 inch
  standard: 36,  // 0.50 inch
};

/**
 * Inspects leading magic bytes to identify the image container format.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat {
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
 * Converts a WebP byte buffer to PNG format using standard HTML5 / OffscreenCanvas APIs.
 * Supports Web Workers (OffscreenCanvas) and DOM environments (HTMLCanvasElement & Image fallback).
 */
export async function convertWebpToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/webp' });

  // 1. Try modern createImageBitmap path (works in workers with OffscreenCanvas, and in modern browsers)
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(blob);
      let pngBlob: Blob | null = null;

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

  throw new Error('WebP conversion is not supported in this runtime environment (requires OffscreenCanvas or DOM Canvas).');
}

/**
 * Converts an ordered list of image files into a single multi-page PDF document.
 */
export async function imagesToPdf(
  images: InputImage[],
  options?: ImagesToPdfOptions
): Promise<Uint8Array> {
  if (!images || images.length === 0) {
    throw new Error('At least one image file is required.');
  }

  const pageSizing: PageSizing = options?.pageSizing || 'fit';
  const marginPreset: MarginPreset = options?.margin || 'none';
  const margin = MARGIN_POINTS[marginPreset];

  const doc = await PDFDocument.create();

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    if (!item.bytes || item.bytes.byteLength === 0) {
      throw new Error(`Image "${item.name}" has empty data.`);
    }

    const format = detectImageFormat(item.bytes);
    if (format === 'unknown') {
      throw new Error(
        `Unsupported or unreadable image format for "${item.name}". Please provide JPEG, PNG, or WebP images.`
      );
    }

    let imageBytes = item.bytes;
    let embedFormat = format;

    if (format === 'webp') {
      try {
        imageBytes = await convertWebpToPng(item.bytes);
        embedFormat = 'png';
      } catch (convErr) {
        throw new Error(
          `Failed to process WebP image "${item.name}": ${convErr instanceof Error ? convErr.message : String(convErr)}`,
          { cause: convErr }
        );
      }
    }

    let embeddedImage;
    try {
      if (embedFormat === 'jpeg') {
        embeddedImage = await doc.embedJpg(imageBytes);
      } else {
        embeddedImage = await doc.embedPng(imageBytes);
      }
    } catch (embedErr) {
      throw new Error(
        `Failed to decode image data for "${item.name}". The file may be corrupt or invalid.`,
        { cause: embedErr }
      );
    }

    const imgWidth = embeddedImage.width;
    const imgHeight = embeddedImage.height;

    let pageWidth: number;
    let pageHeight: number;
    let drawX: number;
    let drawY: number;
    let drawWidth: number;
    let drawHeight: number;

    if (pageSizing === 'fit') {
      // Fit Image mode: Page dimensions match image aspect ratio exactly
      drawWidth = imgWidth;
      drawHeight = imgHeight;
      pageWidth = imgWidth + margin * 2;
      pageHeight = imgHeight + margin * 2;
      drawX = margin;
      drawY = margin;
    } else {
      // A4 mode: Standard paper size with automatic orientation detection
      const isLandscape = imgWidth > imgHeight;
      pageWidth = isLandscape ? A4_HEIGHT : A4_WIDTH;
      pageHeight = isLandscape ? A4_WIDTH : A4_HEIGHT;

      const availWidth = Math.max(pageWidth - margin * 2, 1);
      const availHeight = Math.max(pageHeight - margin * 2, 1);

      const scale = Math.min(availWidth / imgWidth, availHeight / imgHeight);
      drawWidth = imgWidth * scale;
      drawHeight = imgHeight * scale;

      drawX = margin + (availWidth - drawWidth) / 2;
      drawY = margin + (availHeight - drawHeight) / 2;
    }

    const page = doc.addPage([pageWidth, pageHeight]);
    page.drawImage(embeddedImage, {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
    });
  }

  return await doc.save({ useObjectStreams: true });
}
