// Document inspection, classification, and size budgeting for intelligent PDF compression.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
} from 'pdf-lib';

export type DocumentContentType =
  | 'text-vector'
  | 'scanned-image'
  | 'mixed'
  | 'already-optimized';

export interface ImageStreamInfo {
  refString: string;
  width: number;
  height: number;
  filter: 'dct' | 'flate' | 'ccitt' | 'jbig2' | 'other' | 'none';
  colorSpace: string;
  bitsPerComponent: number;
  byteLength: number;
  hasSMask: boolean;
}

export interface DocumentAnalysis {
  pageCount: number;
  originalSize: number;
  contentType: DocumentContentType;
  imageCount: number;
  jpegCount: number;
  flateCount: number;
  monochromeCount: number;
  totalImageBytes: number;
  structuralBytes: number;
  hasInteractiveForms: boolean;
  hasAnnotations: boolean;
  hasSignatures: boolean;
  estimatedMinimumSafeSize: number;
  images: ImageStreamInfo[];
}

function parseFilterType(filter: PDFObject | undefined): 'dct' | 'flate' | 'ccitt' | 'jbig2' | 'other' | 'none' {
  if (!filter) return 'none';

  const filterNames: string[] = [];
  if (filter instanceof PDFName) {
    filterNames.push(filter.asString());
  } else if (filter instanceof PDFArray) {
    for (const item of filter.asArray()) {
      if (item instanceof PDFName) filterNames.push(item.asString());
    }
  } else {
    filterNames.push(filter.toString());
  }

  const str = filterNames.join(' ').toLowerCase();
  if (str.includes('dctdecode')) return 'dct';
  if (str.includes('flatedecode')) return 'flate';
  if (str.includes('ccittfaxdecode')) return 'ccitt';
  if (str.includes('jbig2decode')) return 'jbig2';
  return 'other';
}

function parseColorSpace(cs: PDFObject | undefined): string {
  if (!cs) return 'DeviceRGB';
  if (cs instanceof PDFName) return cs.asString().replace('/', '');
  if (cs instanceof PDFArray) {
    const first = cs.asArray()[0];
    if (first instanceof PDFName) return first.asString().replace('/', '');
  }
  return cs.toString().replace('/', '');
}

/**
 * Analyzes PDF content structure to guide intelligent compression and target-size budgeting.
 */
export async function analyzePdfDocument(buffer: Uint8Array): Promise<DocumentAnalysis> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = doc.getPageCount();
  const originalSize = buffer.byteLength;

  const images: ImageStreamInfo[] = [];
  let totalImageBytes = 0;
  let jpegCount = 0;
  let flateCount = 0;
  let monochromeCount = 0;
  let hasSignatures = false;
  let hasInteractiveForms = false;
  let hasAnnotations = false;

  // Check root catalog for forms, signatures, and document-level structures
  const rootRef = doc.context.trailerInfo.Root;
  if (rootRef) {
    const catalog = doc.context.lookup(rootRef);
    if (catalog instanceof PDFDict) {
      if (catalog.has(PDFName.of('AcroForm'))) {
        hasInteractiveForms = true;
      }
      if (catalog.has(PDFName.of('Perms')) || catalog.has(PDFName.of('DSS'))) {
        hasSignatures = true;
      }
    }
  }

  // Check pages for annotations and signatures
  for (const page of doc.getPages()) {
    const annots = page.node.get(PDFName.of('Annots'));
    if (annots instanceof PDFArray && annots.size() > 0) {
      hasAnnotations = true;
      for (const a of annots.asArray()) {
        const annotDict = a instanceof PDFDict ? a : doc.context.lookup(a);
        if (annotDict instanceof PDFDict) {
          const subtype = annotDict.get(PDFName.of('Subtype'));
          if (subtype?.toString() === '/Widget') {
            const ft = annotDict.get(PDFName.of('FT'));
            if (ft?.toString() === '/Sig') hasSignatures = true;
          }
        }
      }
    }
  }

  // Enumerate indirect stream objects to catalog images and media
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || !obj.dict) continue;

    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!subtype) continue;
    const isImage = subtype instanceof PDFName
      ? subtype.asString() === '/Image' || subtype.asString() === 'Image'
      : subtype.toString() === '/Image';
    if (!isImage) continue;

    const filterObj = obj.dict.get(PDFName.of('Filter'));
    const filter = parseFilterType(filterObj);
    const byteLength = obj.getContents().byteLength;
    totalImageBytes += byteLength;

    const widthObj = obj.dict.get(PDFName.of('Width'));
    const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : 0;

    const heightObj = obj.dict.get(PDFName.of('Height'));
    const height = heightObj instanceof PDFNumber ? heightObj.asNumber() : 0;

    const colorSpace = parseColorSpace(obj.dict.get(PDFName.of('ColorSpace')));
    const bpcObj = obj.dict.get(PDFName.of('BitsPerComponent'));
    const bitsPerComponent = bpcObj instanceof PDFNumber ? bpcObj.asNumber() : 8;

    const hasSMask = obj.dict.has(PDFName.of('SMask'));

    if (filter === 'dct') jpegCount++;
    else if (filter === 'flate') flateCount++;
    else if (filter === 'ccitt' || filter === 'jbig2') monochromeCount++;

    images.push({
      refString: ref.toString(),
      width,
      height,
      filter,
      colorSpace,
      bitsPerComponent,
      byteLength,
      hasSMask,
    });
  }

  const structuralBytes = Math.max(0, originalSize - totalImageBytes);
  const imageCount = images.length;
  const imageByteRatio = originalSize > 0 ? totalImageBytes / originalSize : 0;

  // Determine primary content type
  let contentType: DocumentContentType;
  if (imageCount === 0 || imageByteRatio < 0.10) {
    contentType = 'text-vector';
  } else if (
    imageByteRatio > 0.50 ||
    (imageCount >= pageCount && (totalImageBytes > 200 * 1024 || imageByteRatio > 0.15))
  ) {
    contentType = 'scanned-image';
  } else {
    contentType = 'mixed';
  }

  // Calculate safe estimated minimum size (lower bound for non-destructive compression)
  let estimatedMinimumSafeSize: number;
  if (contentType === 'text-vector') {
    estimatedMinimumSafeSize = Math.max(10 * 1024, Math.round(structuralBytes * 0.65));
  } else if (contentType === 'scanned-image') {
    // Highly compressed readable scans can reach ~30-40 KB per page
    const perPageScanTarget = pageCount * 35 * 1024;
    estimatedMinimumSafeSize = Math.round(structuralBytes * 0.7) + perPageScanTarget;
  } else {
    // Mixed documents (résumés, certificates with photos)
    estimatedMinimumSafeSize = Math.round(structuralBytes * 0.7) + Math.min(totalImageBytes * 0.15, pageCount * 45 * 1024);
  }

  // Ensure minimum estimate is bounded sensibly
  estimatedMinimumSafeSize = Math.min(originalSize, Math.max(15 * 1024, estimatedMinimumSafeSize));

  return {
    pageCount,
    originalSize,
    contentType,
    imageCount,
    jpegCount,
    flateCount,
    monochromeCount,
    totalImageBytes,
    structuralBytes,
    hasInteractiveForms,
    hasAnnotations,
    hasSignatures,
    estimatedMinimumSafeSize,
    images,
  };
}
