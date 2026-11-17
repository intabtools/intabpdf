// Pure core operation for converting one or more images into a single valid PDF document.
// Zero DOM or browser dependencies: accepts typed byte arrays (Uint8Array) and returns transformed byte arrays.
import {
  PDFDocument,
  StandardFonts,
  clip,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from 'pdf-lib';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'unknown';
export type PageSize = 'a4' | 'fit';
export type PageSizing = 'fit' | 'a4'; // Preserved for backward compatibility
export type PageOrientation = 'portrait' | 'landscape' | 'auto';
export type ImageFit = 'contain' | 'cover';
export type PageBackground = 'white' | 'black';
export type MarginPreset = 'none' | 'small' | 'standard';

export interface InputImage {
  name: string;
  bytes: Uint8Array;
  rotation?: number; // Clockwise rotation in degrees: 0, 90, 180, 270
}

export interface ImagesToPdfOptions {
  pageSize?: PageSize;
  pageSizing?: PageSizing; // Backward compatibility alias
  orientation?: PageOrientation;
  imageFit?: ImageFit;
  backgroundColor?: PageBackground;
  margin?: MarginPreset;
  addPageNumbers?: boolean;
}

// Standard A4 dimensions in PDF points (72 points per inch)
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

export const MARGIN_POINTS: Record<MarginPreset, number> = {
  none: 0,
  small: 18, // 0.25 inch
  standard: 36, // 0.50 inch
};

// Reserved bottom margin when page numbering is enabled to prevent overlap
export const FOOTER_RESERVE_POINTS = 28;

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

  // Resolve options with backward compatibility
  const pageSize: PageSize = options?.pageSize ?? options?.pageSizing ?? 'a4';
  const orientation: PageOrientation = options?.orientation ?? 'portrait';
  const imageFit: ImageFit = options?.imageFit ?? 'contain';
  const backgroundColor: PageBackground = options?.backgroundColor ?? 'white';
  const marginPreset: MarginPreset = options?.margin ?? 'none';
  const addPageNumbers = Boolean(options?.addPageNumbers);

  const baseMargin = MARGIN_POINTS[marginPreset] ?? 0;
  const marginTop = baseMargin;
  const marginLeft = baseMargin;
  const marginRight = baseMargin;
  // Reserve bottom space for page numbers so text never overlaps the image content
  const marginBottom = addPageNumbers
    ? Math.max(baseMargin, FOOTER_RESERVE_POINTS)
    : baseMargin;

  const doc = await PDFDocument.create();

  // Decode and embed all images, calculating effective dimensions
  interface EmbeddedItem {
    embedded: Awaited<ReturnType<typeof doc.embedJpg>> | Awaited<ReturnType<typeof doc.embedPng>>;
    rot: number;
    effWidth: number;
    effHeight: number;
  }

  const embeddedList: EmbeddedItem[] = [];

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

    let embedded;
    try {
      if (format === 'jpeg') {
        embedded = await doc.embedJpg(item.bytes);
      } else {
        embedded = await doc.embedPng(item.bytes);
      }
    } catch (embedErr) {
      throw new Error(
        `Failed to decode image data for "${item.name}". The file may be corrupt or invalid.`,
        { cause: embedErr }
      );
    }

    const rot = (((item.rotation || 0) % 360) + 360) % 360;
    const isRotated90or270 = rot === 90 || rot === 270;
    const effWidth = isRotated90or270 ? embedded.height : embedded.width;
    const effHeight = isRotated90or270 ? embedded.width : embedded.height;

    embeddedList.push({
      embedded,
      rot,
      effWidth,
      effHeight,
    });
  }

  // In A4 mode, resolve document-wide orientation (Auto uses majority vote with Portrait tie-breaker)
  let docPageWidth = A4_WIDTH;
  let docPageHeight = A4_HEIGHT;

  if (pageSize === 'a4') {
    let resolvedOrientation: 'portrait' | 'landscape';
    if (orientation === 'auto') {
      let landscapeCount = 0;
      let portraitCount = 0;
      for (const item of embeddedList) {
        if (item.effWidth > item.effHeight) {
          landscapeCount++;
        } else {
          portraitCount++;
        }
      }
      resolvedOrientation = landscapeCount > portraitCount ? 'landscape' : 'portrait';
    } else {
      resolvedOrientation = orientation;
    }

    docPageWidth = resolvedOrientation === 'landscape' ? A4_HEIGHT : A4_WIDTH;
    docPageHeight = resolvedOrientation === 'landscape' ? A4_WIDTH : A4_HEIGHT;
  }

  // Draw each page
  for (let i = 0; i < embeddedList.length; i++) {
    const { embedded, rot, effWidth, effHeight } = embeddedList[i];

    let pageWidth: number;
    let pageHeight: number;

    if (pageSize === 'a4') {
      // Guaranteed 100% uniform page dimensions across every single page
      pageWidth = docPageWidth;
      pageHeight = docPageHeight;
    } else {
      // Fit to Photo: Dimensions match each photo's effective aspect ratio (+ margins)
      pageWidth = effWidth + marginLeft + marginRight;
      pageHeight = effHeight + marginTop + marginBottom;
    }

    const availWidth = Math.max(pageWidth - marginLeft - marginRight, 1);
    const availHeight = Math.max(pageHeight - marginTop - marginBottom, 1);

    const scale =
      imageFit === 'cover'
        ? Math.max(availWidth / effWidth, availHeight / effHeight)
        : Math.min(availWidth / effWidth, availHeight / effHeight);

    const bw = effWidth * scale;
    const bh = effHeight * scale;
    const bx = marginLeft + (availWidth - bw) / 2;
    const by = marginBottom + (availHeight - bh) / 2;

    const page = doc.addPage([pageWidth, pageHeight]);

    // Draw background color if selected
    if (backgroundColor === 'black') {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
        color: rgb(0, 0, 0),
      });
    }

    // If cover mode, clip to printable area to prevent margin bleed
    if (imageFit === 'cover') {
      page.pushOperators(
        pushGraphicsState(),
        rectangle(marginLeft, marginBottom, availWidth, availHeight),
        clip(),
        endPath()
      );
    }

    // Native PDF rotation placement
    if (rot === 0) {
      page.drawImage(embedded, {
        x: bx,
        y: by,
        width: bw,
        height: bh,
        rotate: degrees(0),
      });
    } else if (rot === 90) {
      page.drawImage(embedded, {
        x: bx,
        y: by + bh,
        width: bh,
        height: bw,
        rotate: degrees(270),
      });
    } else if (rot === 180) {
      page.drawImage(embedded, {
        x: bx + bw,
        y: by + bh,
        width: bw,
        height: bh,
        rotate: degrees(180),
      });
    } else if (rot === 270) {
      page.drawImage(embedded, {
        x: bx + bw,
        y: by,
        width: bh,
        height: bw,
        rotate: degrees(90),
      });
    }

    if (imageFit === 'cover') {
      page.pushOperators(popGraphicsState());
    }
  }

  // Draw page numbering if enabled
  if (addPageNumbers) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;
    const textColor =
      backgroundColor === 'black' ? rgb(0.85, 0.85, 0.85) : rgb(0.3, 0.3, 0.3);
    const totalPages = embeddedList.length;

    for (let i = 0; i < totalPages; i++) {
      const page = doc.getPage(i);
      const { width: pWidth } = page.getSize();
      const text = `${i + 1} / ${totalPages}`;
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const textX = (pWidth - textWidth) / 2;
      const textY = Math.max((marginBottom - fontSize) / 2, 8);

      page.drawText(text, {
        x: textX,
        y: textY,
        size: fontSize,
        font,
        color: textColor,
      });
    }
  }

  return await doc.save({ useObjectStreams: true });
}
