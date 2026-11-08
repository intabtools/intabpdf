// Pure core operation for converting one or more images into a single valid PDF document.
// Zero DOM or browser dependencies: accepts typed byte arrays (Uint8Array) and returns transformed byte arrays.
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
  small: 18, // 0.25 inch
  standard: 36, // 0.50 inch
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
 * Converts an ordered list of image files into a single multi-page PDF document.
 * Pure byte-oriented core operation: accepts JPEG and PNG byte arrays.
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
    if (format === 'webp') {
      throw new Error(
        `WebP image "${item.name}" must be converted to PNG or JPEG before core PDF embedding.`
      );
    }
    if (format === 'unknown') {
      throw new Error(
        `Unsupported or unreadable image format for "${item.name}". Please provide JPEG or PNG images.`
      );
    }

    let embeddedImage;
    try {
      if (format === 'jpeg') {
        embeddedImage = await doc.embedJpg(item.bytes);
      } else {
        embeddedImage = await doc.embedPng(item.bytes);
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
