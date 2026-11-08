// PDF page rasterization engine using PDF.js and HTMLCanvasElement.
// Designed to run outside src/core to preserve pure-core architecture.
import { destroyPdf, loadPdf } from '../../../viewer/renderPage';
import { createZip, type ZipEntry } from '../../../core/zip';
import {
  MAX_CUMULATIVE_BYTES,
  type ConvertedPageImage,
  type PdfToImagesOptions,
  type PdfToImagesResult,
} from './types';

export { MAX_CUMULATIVE_BYTES };
export const MAX_RENDER_PIXELS = 25000000; // 25 megapixels safety limit per page

/**
 * Encodes an HTML canvas element into compressed image bytes (PNG or JPEG).
 * Supports both standard canvas.toBlob() and canvas.toDataURL() fallbacks.
 */
export async function canvasToBytes(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Uint8Array> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), mimeType, quality);
    });

    if (blob) {
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    }
  }

  if (typeof canvas.toDataURL === 'function') {
    const dataUrl = canvas.toDataURL(mimeType, quality);
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error('Canvas export is not supported in this environment.');
}

/**
 * Sequentially renders requested PDF pages into image files.
 * Manages memory by disposing canvases and calling page.cleanup() after each rasterization.
 * Supports cancellation via AbortSignal and the active PDF.js renderTask.
 */
export async function renderPdfToImages(
  pdfBytes: Uint8Array,
  options: PdfToImagesOptions
): Promise<PdfToImagesResult> {
  if (!pdfBytes || pdfBytes.byteLength === 0) {
    throw new Error('No PDF file provided for conversion.');
  }

  const {
    format,
    scale,
    jpegQuality = 0.85,
    pages,
    signal,
    onProgress,
    maxCumulativeBytes = MAX_CUMULATIVE_BYTES,
  } = options;

  if (!pages || pages.length === 0) {
    throw new Error('No pages selected for conversion.');
  }

  if (signal?.aborted) {
    throw new Error('Conversion cancelled');
  }

  const doc = await loadPdf(pdfBytes);
  const images: ConvertedPageImage[] = [];
  let cumulativeBytes = 0;

  try {
    for (let i = 0; i < pages.length; i++) {
      if (signal?.aborted) {
        throw new Error('Conversion cancelled');
      }

      const pageNumber = pages[i];
      const page = await doc.getPage(pageNumber);

      try {
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));

        if (width * height > MAX_RENDER_PIXELS) {
          throw new Error(
            `Page ${pageNumber} exceeds practical memory safety limits (${width}×${height}px). Try selecting Standard resolution.`
          );
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas 2D rendering context is not available.');
        }

        // Fill white background for clean rendering and transparency handling
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        const renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
        });

        const abortHandler = () => {
          try {
            renderTask.cancel();
          } catch {
            // Ignore cancel errors
          }
        };

        if (signal) {
          signal.addEventListener('abort', abortHandler, { once: true });
        }

        try {
          await renderTask.promise;
        } catch (err: unknown) {
          if (
            signal?.aborted ||
            (err instanceof Error &&
              (err.name === 'RenderingCancelledException' ||
                err.name === 'AbortException' ||
                err.message.includes('cancelled')))
          ) {
            throw new Error('Conversion cancelled', { cause: err });
          }
          throw err;
        } finally {
          if (signal) {
            signal.removeEventListener('abort', abortHandler);
          }
        }

        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const imageBytes = await canvasToBytes(canvas, mimeType, jpegQuality);

        cumulativeBytes += imageBytes.byteLength;
        if (cumulativeBytes > maxCumulativeBytes) {
          const thresholdMb = Math.round(maxCumulativeBytes / (1024 * 1024));
          throw new Error(
            `Cumulative image output exceeded memory safety threshold (${thresholdMb} MB). To convert more pages without exceeding memory limits, select High (2×) resolution or JPEG format.`
          );
        }

        // Deallocate canvas dimensions immediately
        canvas.width = 0;
        canvas.height = 0;

        const paddedPage = String(pageNumber).padStart(3, '0');
        const fileName = `page-${paddedPage}.${ext}`;

        images.push({
          pageNumber,
          fileName,
          bytes: imageBytes,
          width,
          height,
        });
      } finally {
        page.cleanup();
      }

      // Micro-task yield to allow browser garbage collection and UI paint
      await new Promise((resolve) => setTimeout(resolve, 0));

      onProgress?.({
        current: i + 1,
        total: pages.length,
        pageNumber,
        percent: Math.round(((i + 1) / pages.length) * 100),
      });
    }
  } finally {
    await destroyPdf(doc);
  }

  const isZip = images.length > 1;

  if (!isZip) {
    const single = images[0];
    return {
      outputBytes: single.bytes,
      isZip: false,
      outputExtension: format === 'jpeg' ? '.jpg' : '.png',
      pageCount: 1,
      format,
      scale,
      singleFileName: single.fileName,
      images,
    };
  }

  // Multi-page export: package into clean ZIP archive using existing pure createZip
  const zipEntries: ZipEntry[] = images.map((img) => ({
    name: img.fileName,
    bytes: img.bytes,
  }));

  const zipBytes = createZip(zipEntries);

  return {
    outputBytes: zipBytes,
    isZip: true,
    outputExtension: '.zip',
    pageCount: images.length,
    format,
    scale,
    images,
  };
}
