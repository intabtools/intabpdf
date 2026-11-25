// Pure core operation for stamping a visual signature and optional date onto a PDF document.
// Zero DOM or browser dependencies: accepts typed byte arrays (Uint8Array) and returns transformed byte array.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type SignaturePosition = 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';

export interface SignOptions {
  pageIndex?: number; // 0-based page index (defaults to last page)
  position?: SignaturePosition;
  x?: number; // Custom X coordinate in PDF points
  y?: number; // Custom Y coordinate in PDF points
  width?: number; // Width of signature in PDF points (default 140)
  height?: number; // Height of signature in PDF points (default 50)
  addDate?: boolean;
  dateText?: string; // Optional custom date string, defaults to YYYY-MM-DD
}

/**
 * Stamps a visual signature image and optional date onto a specific page of a PDF document.
 * Note: This produces a visual signature stamp, not a cryptographic PKI digital certificate.
 */
export async function signPdf(
  buffer: Uint8Array,
  signatureImageBytes: Uint8Array,
  options: SignOptions = {},
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Sign operation requires a valid PDF buffer.');
  }

  if (!signatureImageBytes || signatureImageBytes.byteLength === 0) {
    throw new Error('Sign operation requires a valid signature image.');
  }

  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = doc.getPageCount();

  if (pageCount === 0) {
    throw new Error('Cannot sign an empty PDF document.');
  }

  const targetPageIndex =
    options.pageIndex !== undefined && options.pageIndex >= 0 && options.pageIndex < pageCount
      ? options.pageIndex
      : pageCount - 1; // Default to the last page

  const page = doc.getPage(targetPageIndex);
  const { width: pWidth, height: pHeight } = page.getSize();

  // Embed signature image (detect PNG vs JPEG)
  const isPng =
    signatureImageBytes.length >= 8 &&
    signatureImageBytes[0] === 0x89 &&
    signatureImageBytes[1] === 0x50 &&
    signatureImageBytes[2] === 0x4e &&
    signatureImageBytes[3] === 0x47;

  const embeddedImage = isPng
    ? await doc.embedPng(signatureImageBytes)
    : await doc.embedJpg(signatureImageBytes);

  const sigWidth = options.width ?? 140;
  const sigHeight = options.height ?? 50;

  // Resolve position coordinates
  let posX = options.x;
  let posY = options.y;

  const margin = 36; // 0.5 inch margin

  if (posX === undefined || posY === undefined) {
    const pos = options.position ?? 'bottom-right';
    switch (pos) {
      case 'bottom-left':
        posX = margin;
        posY = margin;
        break;
      case 'bottom-center':
        posX = (pWidth - sigWidth) / 2;
        posY = margin;
        break;
      case 'top-left':
        posX = margin;
        posY = pHeight - sigHeight - margin;
        break;
      case 'top-right':
        posX = pWidth - sigWidth - margin;
        posY = pHeight - sigHeight - margin;
        break;
      case 'bottom-right':
      default:
        posX = pWidth - sigWidth - margin;
        posY = margin;
        break;
    }
  }

  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  // Draw signature image
  page.drawImage(embeddedImage, {
    x: posX,
    y: posY,
    width: sigWidth,
    height: sigHeight,
  });

  // Draw optional date string below or beside signature
  if (options.addDate) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const dateFontSize = 8;
    const formattedDate =
      options.dateText ??
      new Date().toISOString().slice(0, 10);
    const label = `Signed: ${formattedDate}`;

    page.drawText(label, {
      x: posX,
      y: Math.max(posY - 10, 8),
      size: dateFontSize,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  return await doc.save({ useObjectStreams: true });
}
