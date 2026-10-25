// Pure core operation for local, client-side PDF document compression with target size support.
import {
  EncryptedPDFError,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from 'pdf-lib';

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
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
          resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        }
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
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
