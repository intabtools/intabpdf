// Pure core operation for local, client-side PDF document compression with target size support.
import {
  EncryptedPDFError,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from 'pdf-lib';
import { recompressJpegBytes } from './image-compression';

export { recompressJpegBytes } from './image-compression';

export type CompressionPreset = 'light' | 'balanced' | 'strong';

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

  // 1. Process embedded JPEG images (/Filter /DCTDecode)
  const objects = doc.context.enumerateIndirectObjects();
  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream) || !obj.dict) continue;

    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;

    const filter = obj.dict.get(PDFName.of('Filter'));
    if (!filter || filter.toString() !== '/DCTDecode') continue;

    const existingBytes = obj.getContents();
    if (!existingBytes || existingBytes.byteLength === 0) continue;

    // Verify JPEG magic bytes 0xFF 0xD8
    if (existingBytes.length < 4 || existingBytes[0] !== 0xff || existingBytes[1] !== 0xd8) {
      continue;
    }

    try {
      const recompressed = await recompressJpegBytes(
        existingBytes,
        settings.quality,
        settings.maxDimension
      );
      // Strictly only replace if newly re-encoded version is smaller than existing stream
      if (recompressed && recompressed.bytes.byteLength < existingBytes.byteLength) {
        obj.dict.set(PDFName.of('Width'), PDFNumber.of(recompressed.width));
        obj.dict.set(PDFName.of('Height'), PDFNumber.of(recompressed.height));
        const newStream = PDFRawStream.of(obj.dict, recompressed.bytes);
        doc.context.assign(ref, newStream);
      }
    } catch {
      // If recompression fails for an individual image, keep original image intact
    }
  }

  // 2. Strip redundant metadata if enabled
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

  // 3. Save with Flate object streams enabled
  return await doc.save({ useObjectStreams: true });
}

/**
 * Compresses a PDF document.
 * If options.targetBytes is specified, executes an iterative bounded compression strategy
 * to approach the desired size while preserving best visual quality.
 * If options.preset is specified, executes a single-pass preset compression.
 * Guarantees that the returned PDF bytes are never larger than the input.
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

  // -------------------------------------------------------------
  // STRATEGY A: Target File Size Iterative Bounded Compression
  // -------------------------------------------------------------
  if (targetBytes !== undefined && targetBytes > 0) {
    // If original is already within target bytes, run light structural pass
    if (buffer.byteLength <= targetBytes) {
      const lightResult = await runCompressionPass(buffer, {
        quality: 0.85,
        maxDimension: undefined,
        stripMetadata: options?.stripMetadata ?? false,
      });
      return lightResult.byteLength < buffer.byteLength ? lightResult : buffer;
    }

    // Inspect if document contains any JPEG images
    const initialDoc = await PDFDocument.load(buffer);
    let hasJpegImages = false;
    for (const [, obj] of initialDoc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict) {
        const subtype = obj.dict.get(PDFName.of('Subtype'));
        const filter = obj.dict.get(PDFName.of('Filter'));
        if (subtype?.toString() === '/Image' && filter?.toString() === '/DCTDecode') {
          hasJpegImages = true;
          break;
        }
      }
    }

    const shouldDownsample = options?.downsampleImages !== false;
    const shouldStrip = options?.stripMetadata !== false;

    // Bounded search stages: progressively increases compression only as needed
    const stages: PassSettings[] = [
      // Stage 0: Gentle structural cleanup & high image quality (0.85, no downsample)
      { quality: 0.85, maxDimension: undefined, stripMetadata: shouldStrip },
      // Stage 1: Balanced (0.70, max 1600px)
      { quality: 0.70, maxDimension: shouldDownsample ? 1600 : undefined, stripMetadata: shouldStrip },
      // Stage 2: Moderate (0.55, max 1280px)
      { quality: 0.55, maxDimension: shouldDownsample ? 1280 : undefined, stripMetadata: shouldStrip },
      // Stage 3: Strong (0.40, max 1000px)
      { quality: 0.40, maxDimension: shouldDownsample ? 1000 : undefined, stripMetadata: shouldStrip },
      // Stage 4: Maximum safe compression (0.30, max 800px)
      { quality: 0.30, maxDimension: shouldDownsample ? 800 : undefined, stripMetadata: shouldStrip },
    ];

    let bestOutput: Uint8Array = buffer;
    let bestSize = buffer.byteLength;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      // If document has no JPEG images, stages 1-4 cannot produce further reduction
      if (!hasJpegImages && i > 0) {
        break;
      }

      const passResult = await runCompressionPass(buffer, stage);

      if (passResult.byteLength < bestSize) {
        bestOutput = passResult;
        bestSize = passResult.byteLength;
      }

      // If output meets or beats target, stop immediately!
      if (bestSize <= targetBytes) {
        break;
      }

      // If Stage 1 produced no improvement over Stage 0, images couldn't be compressed
      if (i === 1 && passResult.byteLength >= bestSize && hasJpegImages) {
        // Test stage 2 once; if still no improvement, terminate search
      }
      if (i === 2 && passResult.byteLength >= bestSize) {
        break;
      }
    }

    return bestOutput;
  }

  // -------------------------------------------------------------
  // STRATEGY B: Preset-Based Single-Pass Compression
  // -------------------------------------------------------------
  const preset: CompressionPreset = options?.preset || 'balanced';
  const shouldDownsample = options?.downsampleImages ?? (preset !== 'light');
  const shouldStripMeta = options?.stripMetadata ?? (preset !== 'light');

  let quality: number;
  let maxDim: number | undefined;

  switch (preset) {
    case 'light':
      quality = 0.85;
      maxDim = undefined;
      break;
    case 'strong':
      quality = 0.50;
      maxDim = shouldDownsample ? 1024 : undefined;
      break;
    case 'balanced':
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
