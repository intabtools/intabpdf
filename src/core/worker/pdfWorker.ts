// Web Worker for offloading CPU-intensive PDF operations from the main UI thread.
import {
  compressPdf,
  imagesToPdf,
  mergePdfs,
  removePdfPages,
  rotatePdfPages,
  splitPdfPages,
} from '../index';
import type { PageRange, SplitOptions } from '../split';
import type { ImagesToPdfOptions, InputImage } from '../images-to-pdf';
import type { RotateOptions } from '../rotate';
import type { CompressOptions } from '../compress';

interface WorkerMessageData {
  id: string;
  operation: 'merge' | 'rotate' | 'remove-pages' | 'split' | 'images-to-pdf' | 'compress';
  payload: {
    buffers?: Uint8Array[];
    buffer?: Uint8Array;
    options?: RotateOptions | ImagesToPdfOptions | CompressOptions;
    pageIndices?: number[];
    ranges?: PageRange[];
    splitOptions?: SplitOptions;
    images?: InputImage[];
    imageOptions?: ImagesToPdfOptions;
    compressOptions?: CompressOptions;
  };
}

self.onmessage = async (e: MessageEvent<WorkerMessageData>) => {
  const { id, operation, payload } = e.data;

  try {
    let result: Uint8Array;

    switch (operation) {
      case 'merge': {
        if (!payload.buffers || payload.buffers.length === 0) {
          throw new Error('Merge operation requires at least one PDF buffer.');
        }
        result = await mergePdfs(payload.buffers);
        break;
      }
      case 'rotate': {
        if (!payload.buffer) {
          throw new Error('Rotate operation requires a PDF buffer.');
        }
        result = await rotatePdfPages(payload.buffer, payload.options as RotateOptions | undefined);
        break;
      }
      case 'remove-pages': {
        if (!payload.buffer) {
          throw new Error('Remove pages operation requires a PDF buffer.');
        }
        result = await removePdfPages(payload.buffer, payload.pageIndices || []);
        break;
      }
      case 'split': {
        if (!payload.buffer) {
          throw new Error('Split operation requires a PDF buffer.');
        }
        if (!payload.ranges || payload.ranges.length === 0) {
          throw new Error('Split operation requires at least one page range.');
        }
        const splitRes = await splitPdfPages(payload.buffer, payload.ranges, payload.splitOptions);
        result = splitRes.zipBytes;
        break;
      }
      case 'images-to-pdf': {
        if (!payload.images || payload.images.length === 0) {
          throw new Error('Images to PDF operation requires at least one image.');
        }
        const imgOptions = (payload.options || payload.imageOptions) as ImagesToPdfOptions | undefined;
        result = await imagesToPdf(payload.images, imgOptions);
        break;
      }
      case 'compress': {
        if (!payload.buffer) {
          throw new Error('Compress operation requires a PDF buffer.');
        }
        const compOptions = (payload.options || payload.compressOptions) as CompressOptions | undefined;
        result = await compressPdf(payload.buffer, compOptions);
        break;
      }
      default:
        throw new Error(`Unsupported worker operation: "${String(operation)}"`);
    }

    // Zero-copy transfer of the result ArrayBuffer
    (self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void }).postMessage(
      { id, ok: true, result },
      [result.buffer]
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    (self as unknown as { postMessage: (msg: unknown) => void }).postMessage({ id, ok: false, error: errorMsg });
  }
};
