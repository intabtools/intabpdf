// Pure core operation for local, client-side PDF document compression with target size support.
import {
  decodePDFRawStream,
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
} from 'pdf-lib';
import {
  recompressJpegBytes,
  recompressRasterPixels,
  undoPngPredictor,
  undoTiffPredictor,
} from './image-compression';
import { analyzePdfDocument } from './document-analysis';

export { recompressJpegBytes } from './image-compression';
export { analyzePdfDocument } from './document-analysis';

export type CompressionPreset =
  | 'light'
  | 'balanced'
  | 'strong'
  | 'recommended'
  | 'smaller'
  | 'high-quality';

export interface CompressOptions {
  preset?: CompressionPreset;
  targetBytes?: number;
  downsampleImages?: boolean;
  stripMetadata?: boolean;
}

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  savedBytes: number;
  savedPercent: number;
  isAlreadyOptimized: boolean;
  targetBytes?: number;
  targetAchieved?: boolean;
}

/**
 * Checks whether a PDF stream filter contains DCTDecode (JPEG compression).
 */
function isDctDecodeFilter(filter: PDFObject | undefined): boolean {
  if (!filter) return false;
  if (filter instanceof PDFName) {
    const s = filter.asString();
    return s === '/DCTDecode' || s === 'DCTDecode';
  }
  if (filter instanceof PDFArray) {
    return filter.asArray().some((item) => {
      if (item instanceof PDFName) {
        const s = item.asString();
        return s === '/DCTDecode' || s === 'DCTDecode';
      }
      return false;
    });
  }
  const str = filter.toString();
  return str === '/DCTDecode' || str.includes('DCTDecode');
}

/**
 * Checks whether a PDF stream filter contains FlateDecode (deflate compression).
 */
function isFlateDecodeFilter(filter: PDFObject | undefined): boolean {
  if (!filter) return false;
  if (filter instanceof PDFName) {
    const s = filter.asString();
    return s === '/FlateDecode' || s === 'FlateDecode';
  }
  if (filter instanceof PDFArray) {
    return filter.asArray().some((item) => {
      if (item instanceof PDFName) {
        const s = item.asString();
        return s === '/FlateDecode' || s === 'FlateDecode';
      }
      return false;
    });
  }
  const str = filter.toString();
  return str === '/FlateDecode' || str.includes('FlateDecode');
}

/**
 * Checks whether a PDF indirect object represents an Image XObject.
 */
function isImageSubtype(subtype: PDFObject | undefined): boolean {
  if (!subtype) return false;
  if (subtype instanceof PDFName) {
    const s = subtype.asString();
    return s === '/Image' || s === 'Image';
  }
  return subtype.toString() === '/Image';
}

interface ColorSpaceInfo {
  isSupported: boolean;
  colors: number;
  isCmyk?: boolean;
}

/**
 * Validates and extracts color components from a PDF ColorSpace object.
 * Safely rejects unsupported or complex color spaces (e.g. Indexed palettes, Separation, Pattern)
 * to avoid image distortion or stream corruption.
 */
function parseColorSpaceInfo(cs: PDFObject | undefined): ColorSpaceInfo {
  if (!cs) return { isSupported: true, colors: 3 }; // Default DeviceRGB
  if (cs instanceof PDFName) {
    const s = cs.asString().toLowerCase();
    if (s === '/devicergb' || s === 'devicergb') return { isSupported: true, colors: 3 };
    if (s === '/devicegray' || s === 'devicegray') return { isSupported: true, colors: 1 };
    if (s === '/devicecmyk' || s === 'devicecmyk') return { isSupported: true, colors: 4, isCmyk: true };
    return { isSupported: false, colors: 0 };
  }
  if (cs instanceof PDFArray) {
    const first = cs.asArray()[0];
    if (first instanceof PDFName) {
      const s = first.asString().toLowerCase();
      // Indexed, Separation, Pattern, Lab, etc. are NOT direct continuous-tone arrays
      if (s.includes('indexed') || s.includes('separation') || s.includes('pattern') || s.includes('lab')) {
        return { isSupported: false, colors: 0 };
      }
      if (s.includes('calgray')) return { isSupported: true, colors: 1 };
      if (s.includes('calrgb')) return { isSupported: true, colors: 3 };
    }
  }
  const str = cs.toString().toLowerCase();
  if (str.includes('indexed') || str.includes('separation') || str.includes('pattern') || str.includes('lab')) {
    return { isSupported: false, colors: 0 };
  }
  if (str.includes('gray')) return { isSupported: true, colors: 1 };
  if (str.includes('cmyk')) return { isSupported: true, colors: 4, isCmyk: true };
  if (str.includes('rgb')) return { isSupported: true, colors: 3 };
  return { isSupported: false, colors: 0 };
}

/**
 * Calculates human-readable compression statistics.
 * Accurately determines if target size was achieved (final bytes <= targetBytes).
 */
export function calculateCompressionStats(
  originalSize: number,
  compressedSize: number,
  targetBytes?: number
): CompressionStats {
  const isAlreadyOptimized = compressedSize >= originalSize;
  const savedBytes = isAlreadyOptimized ? 0 : Math.max(0, originalSize - compressedSize);
  const savedPercent =
    originalSize > 0 && !isAlreadyOptimized
      ? Number(((savedBytes / originalSize) * 100).toFixed(1))
      : 0;

  let targetAchieved: boolean | undefined = undefined;
  if (targetBytes !== undefined && targetBytes > 0) {
    // Strictly at or below requested target byte limit
    targetAchieved = compressedSize <= targetBytes;
  }

  return {
    originalSize,
    compressedSize,
    savedBytes,
    savedPercent,
    isAlreadyOptimized,
    targetBytes,
    targetAchieved,
  };
}

interface PassSettings {
  quality: number;
  maxDimension?: number;
  stripMetadata: boolean;
}

/**
 * Runs a single compression pass on a PDF buffer with given settings.
 */
async function runCompressionPass(
  buffer: Uint8Array,
  settings: PassSettings
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });

  // Process embedded raster images: both DCTDecode (JPEG) and FlateDecode (uncompressed/zlib bitmaps)
  const objects = doc.context.enumerateIndirectObjects();
  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream) || !obj.dict) continue;

    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!isImageSubtype(subtype)) continue;

    const filter = obj.dict.get(PDFName.of('Filter'));
    const existingBytes = obj.getContents();
    if (!existingBytes || existingBytes.byteLength === 0) continue;

    const hasSMask = obj.dict.has(PDFName.of('SMask'));
    // If image has a soft mask, avoid downscaling to keep aspect and mask alignment 100% matched
    const effectiveMaxDim = hasSMask ? undefined : settings.maxDimension;

    // 1. Process DCTDecode images (JPEG)
    if (isDctDecodeFilter(filter)) {
      if (existingBytes.length >= 4 && existingBytes[0] === 0xff && existingBytes[1] === 0xd8) {
        try {
          const recompressed = await recompressJpegBytes(
            existingBytes,
            settings.quality,
            effectiveMaxDim
          );
          if (recompressed && recompressed.bytes.byteLength < existingBytes.byteLength) {
            obj.dict.set(PDFName.of('Width'), PDFNumber.of(recompressed.width));
            obj.dict.set(PDFName.of('Height'), PDFNumber.of(recompressed.height));
            const newStream = PDFRawStream.of(obj.dict, recompressed.bytes);
            doc.context.assign(ref, newStream);
          }
        } catch {
          // If recompression fails, keep original image intact
        }
      }
      continue;
    }

    // 2. Process FlateDecode continuous-tone images (converts bloated raw RGB/Gray scans into JPEG)
    if (isFlateDecodeFilter(filter) || !filter) {
      const bpcObj = obj.dict.get(PDFName.of('BitsPerComponent'));
      const bitsPerComponent = bpcObj instanceof PDFNumber ? bpcObj.asNumber() : 8;

      // Only recompress 8-bit continuous tone images (never 1-bit monochrome scans/faxes)
      if (bitsPerComponent === 8) {
        const wObj = obj.dict.get(PDFName.of('Width'));
        const hObj = obj.dict.get(PDFName.of('Height'));
        const width = wObj instanceof PDFNumber ? wObj.asNumber() : 0;
        const height = hObj instanceof PDFNumber ? hObj.asNumber() : 0;

        if (width > 0 && height > 0) {
          const csObj = obj.dict.get(PDFName.of('ColorSpace'));
          const csInfo = parseColorSpaceInfo(csObj);
          if (!csInfo.isSupported) {
            continue; // Safely preserve original stream (e.g. Indexed palette or Separation)
          }

          try {
            const decodedStream = decodePDFRawStream(obj);
            const decodedBytes = decodedStream.decode();
            let rawPixels: Uint8Array = new Uint8Array(
              decodedBytes.buffer,
              decodedBytes.byteOffset,
              decodedBytes.byteLength
            );

            // Undo predictor if present
            const decodeParms = obj.dict.get(PDFName.of('DecodeParms'));
            if (decodeParms instanceof PDFDict) {
              const predObj = decodeParms.get(PDFName.of('Predictor'));
              const predictor = predObj instanceof PDFNumber ? predObj.asNumber() : 1;
              if (predictor === 2) {
                rawPixels = undoTiffPredictor(rawPixels, width, height, csInfo.colors, bitsPerComponent);
              } else if (predictor >= 10) {
                rawPixels = undoPngPredictor(rawPixels, width, height, csInfo.colors, bitsPerComponent);
              }
            }

            // Verify reconstructed buffer matches expected byte dimensions
            const expectedBytes = width * height * csInfo.colors;
            if (rawPixels.byteLength !== expectedBytes) {
              continue; // Buffer dimension mismatch, safely keep original stream
            }

            const recompressed = await recompressRasterPixels(
              rawPixels,
              width,
              height,
              csInfo.colors,
              settings.quality,
              effectiveMaxDim,
              csInfo.isCmyk
            );

            // Strictly only replace if re-encoded version is smaller than existing stream
            if (recompressed && recompressed.bytes.byteLength < existingBytes.byteLength) {
              obj.dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
              obj.dict.delete(PDFName.of('DecodeParms'));
              obj.dict.set(PDFName.of('Width'), PDFNumber.of(recompressed.width));
              obj.dict.set(PDFName.of('Height'), PDFNumber.of(recompressed.height));
              obj.dict.set(
                PDFName.of('ColorSpace'),
                csInfo.colors === 1 ? PDFName.of('DeviceGray') : PDFName.of('DeviceRGB')
              );
              obj.dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
              const newStream = PDFRawStream.of(obj.dict, recompressed.bytes);
              doc.context.assign(ref, newStream);
            }
          } catch {
            // Keep original stream if decoding or recompression encounters issues
          }
        }
      }
    }
  }

  // 3. Strip redundant metadata if enabled (strictly preserves /Annots, links, and page structures)
  if (settings.stripMetadata) {
    try {
      const rootRef = doc.context.trailerInfo.Root;
      if (rootRef) {
        const catalog = doc.context.lookup(rootRef);
        if (catalog instanceof PDFDict) {
          catalog.delete(PDFName.of('Metadata'));
          catalog.delete(PDFName.of('PieceInfo'));
        }
      }
      for (const page of doc.getPages()) {
        page.node.delete(PDFName.of('Thumb'));
        page.node.delete(PDFName.of('PieceInfo'));
      }
    } catch {
      // Non-critical cleanup failure, safely ignore
    }
  }

  // 4. Save with Flate object streams enabled, comparing with non-object-stream to pick smallest
  const withObjStreams = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  if (withObjStreams.byteLength < buffer.byteLength) {
    return withObjStreams;
  }
  const withoutObjStreams = await doc.save({ useObjectStreams: false, addDefaultPage: false });
  return withoutObjStreams.byteLength < withObjStreams.byteLength ? withoutObjStreams : withObjStreams;
}

/**
 * Compresses a PDF document.
 * If options.targetBytes is specified, executes an intelligent bounded compression strategy
 * guided by document content analysis to reach the target size while maximizing visual quality.
 * If options.preset is specified, executes a single-pass preset compression.
 * Guarantees that the returned PDF bytes are valid and never larger than the input.
 */
export async function compressPdf(
  buffer: Uint8Array,
  options?: CompressOptions
): Promise<Uint8Array> {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('The provided PDF file is empty.');
  }

  // Pre-validate encryption and corrupt structure upfront
  try {
    const testDoc = await PDFDocument.load(buffer, { ignoreEncryption: false });
    if (testDoc.getPageCount() === 0) {
      throw new Error('PDF has 0 pages');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('encrypt') || err instanceof EncryptedPDFError) {
      throw new Error(
        'This PDF is password-protected or encrypted. Please remove password protection before compressing.',
        { cause: err }
      );
    }
    throw new Error(
      'Failed to read PDF document. The file may be corrupt or invalid.',
      { cause: err }
    );
  }

  const targetBytes = options?.targetBytes;
  const analysis = await analyzePdfDocument(buffer);

  // -------------------------------------------------------------
  // STRATEGY A: Target File Size Adaptive Bounded Compression
  // -------------------------------------------------------------
  if (targetBytes !== undefined && targetBytes > 0) {
    // 1. If original is already within target bytes, run light structural pass
    if (buffer.byteLength <= targetBytes) {
      const lightResult = await runCompressionPass(buffer, {
        quality: 0.85,
        maxDimension: undefined,
        stripMetadata: options?.stripMetadata ?? false,
      });
      return lightResult.byteLength < buffer.byteLength ? lightResult : buffer;
    }

    const shouldDownsample = options?.downsampleImages !== false;
    const shouldStrip = options?.stripMetadata !== false;

    // Check if document has compressible raster images
    const hasCompressibleImages = analysis.jpegCount > 0 || analysis.flateCount > 0;

    // Calculate budget for images
    const structuralEst = Math.min(analysis.structuralBytes, Math.round(targetBytes * 0.4));
    const availableImageBudget = Math.max(1024, targetBytes - structuralEst);
    const requiredImageRatio =
      analysis.totalImageBytes > 0 ? availableImageBudget / analysis.totalImageBytes : 1;

    // Build adaptive stages tailored to the target budget
    const stages: PassSettings[] = [];

    if (requiredImageRatio > 0.65) {
      stages.push({
        quality: 0.80,
        maxDimension: shouldDownsample ? 1920 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.70,
        maxDimension: shouldDownsample ? 1600 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.55,
        maxDimension: shouldDownsample ? 1280 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.40,
        maxDimension: shouldDownsample ? 1000 : undefined,
        stripMetadata: shouldStrip,
      });
    } else if (requiredImageRatio > 0.35) {
      stages.push({
        quality: 0.70,
        maxDimension: shouldDownsample ? 1600 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.55,
        maxDimension: shouldDownsample ? 1280 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.40,
        maxDimension: shouldDownsample ? 1000 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.30,
        maxDimension: shouldDownsample ? 800 : undefined,
        stripMetadata: shouldStrip,
      });
    } else if (requiredImageRatio > 0.15) {
      stages.push({
        quality: 0.55,
        maxDimension: shouldDownsample ? 1280 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.42,
        maxDimension: shouldDownsample ? 1000 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.30,
        maxDimension: shouldDownsample ? 800 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.22,
        maxDimension: shouldDownsample ? 650 : undefined,
        stripMetadata: shouldStrip,
      });
    } else {
      stages.push({
        quality: 0.45,
        maxDimension: shouldDownsample ? 1000 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.32,
        maxDimension: shouldDownsample ? 800 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.24,
        maxDimension: shouldDownsample ? 650 : undefined,
        stripMetadata: shouldStrip,
      });
      stages.push({
        quality: 0.18,
        maxDimension: shouldDownsample ? 500 : undefined,
        stripMetadata: shouldStrip,
      });
    }

    let bestOutput: Uint8Array = buffer;
    let bestSize = buffer.byteLength;
    let consecutiveNoImprovementCount = 0;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      // If document has no raster images, subsequent image stages cannot reduce further
      if (!hasCompressibleImages && i > 0) {
        break;
      }

      const passResult = await runCompressionPass(buffer, stage);

      if (passResult.byteLength < bestSize) {
        const improvement = bestSize - passResult.byteLength;
        bestOutput = passResult;
        bestSize = passResult.byteLength;
        consecutiveNoImprovementCount = 0;

        // If output meets or beats target, stop immediately to preserve best visual fidelity!
        if (bestSize <= targetBytes) {
          break;
        }

        if (improvement < buffer.byteLength * 0.005) {
          consecutiveNoImprovementCount++;
        }
      } else {
        consecutiveNoImprovementCount++;
      }

      if (consecutiveNoImprovementCount >= 2 && i >= 2) {
        break;
      }
    }

    // Integrity safety: verify PDF structure before returning
    try {
      if (bestOutput !== buffer) {
        await PDFDocument.load(bestOutput, { ignoreEncryption: true });
      }
    } catch {
      return buffer;
    }

    return bestOutput;
  }

  // -------------------------------------------------------------
  // STRATEGY B: Preset-Based Single-Pass Compression
  // -------------------------------------------------------------
  const preset: CompressionPreset = options?.preset || 'recommended';
  const shouldDownsample =
    options?.downsampleImages ?? (preset !== 'light' && preset !== 'high-quality');
  const shouldStripMeta =
    options?.stripMetadata ?? (preset !== 'light' && preset !== 'high-quality');

  let quality: number;
  let maxDim: number | undefined;

  switch (preset) {
    case 'light':
    case 'high-quality':
      quality = 0.85;
      maxDim = undefined;
      break;
    case 'strong':
    case 'smaller':
      quality = 0.48;
      maxDim = shouldDownsample ? 1024 : undefined;
      break;
    case 'balanced':
    case 'recommended':
    default:
      quality = 0.70;
      maxDim = shouldDownsample ? 1600 : undefined;
      break;
  }

  const result = await runCompressionPass(buffer, {
    quality,
    maxDimension: maxDim,
    stripMetadata: shouldStripMeta,
  });

  return result.byteLength < buffer.byteLength ? result : buffer;
}
