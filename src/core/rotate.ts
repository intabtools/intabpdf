import { PDFDocument, degrees } from 'pdf-lib';

export interface RotateOptions {
  clockwise?: boolean;
  allPages?: boolean;
  pageIndices?: number[];
  rotationDegrees?: number;
}

/**
 * Rotate pages of a PDF document by 90 degrees clockwise or counterclockwise.
 */
export async function rotatePdfPages(
  pdfBuffer: Uint8Array,
  options: RotateOptions = {}
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  if (totalPages === 0) {
    throw new Error('PDF document contains no pages to rotate.');
  }

  const angleDelta =
    options.rotationDegrees !== undefined
      ? options.rotationDegrees
      : options.clockwise !== false
        ? 90
        : -90;

  const targetIndices =
    options.allPages !== false || !options.pageIndices || options.pageIndices.length === 0
      ? pdfDoc.getPageIndices()
      : options.pageIndices.filter((idx) => idx >= 0 && idx < totalPages);

  for (const idx of targetIndices) {
    const page = pdfDoc.getPage(idx);
    const currentAngle = page.getRotation().angle;
    const newAngle = ((currentAngle + angleDelta) % 360 + 360) % 360;
    page.setRotation(degrees(newAngle));
  }

  return await pdfDoc.save();
}
