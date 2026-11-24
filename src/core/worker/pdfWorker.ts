// Web Worker for offloading CPU-intensive PDF operations from the main UI thread.
import {
  compressPdf,
  imagesToPdf,
  mergePdfs,
  protectPdf,
  removePdfPages,
  reorderPdfPages,
  rotatePdfPages,
  signPdf,
  splitPdfPages,
  textToPdf,
  unlockPdf,
} from '../index';
import type { PageRange, SplitOptions } from '../split';
import type { ImagesToPdfOptions, InputImage } from '../images-to-pdf';
import type { RotateOptions } from '../rotate';
import type { CompressOptions } from '../compress';
import type { MergeOptions } from '../merge';
import type { TextToPdfOptions } from '../text-to-pdf';
import type { ReorderOptions } from '../reorder';
import type { SignOptions } from '../sign';
import type { ProtectPdfOptions } from '../protect';
import type { UnlockPdfOptions } from '../unlock';

interface WorkerMessageData {
  id: string;
  operation: 'merge' | 'rotate' | 'remove-pages' | 'split' | 'images-to-pdf' | 'compress' | 'text-to-pdf' | 'reorder' | 'sign' | 'protect' | 'unlock';
  payload: {
    buffers?: Uint8Array[];
    buffer?: Uint8Array;
    text?: string;
    textOptions?: TextToPdfOptions;
    pageOrder?: number[];
    reorderOptions?: ReorderOptions;
    signatureBytes?: Uint8Array;
    signOptions?: SignOptions;
    protectOptions?: ProtectPdfOptions;
    unlockOptions?: UnlockPdfOptions;
    options?: MergeOptions | RotateOptions | ImagesToPdfOptions | CompressOptions | TextToPdfOptions | ReorderOptions | SignOptions | ProtectPdfOptions | UnlockPdfOptions;
    mergeOptions?: MergeOptions;
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
        const mergeOptions = (payload.options || payload.mergeOptions) as MergeOptions | undefined;
        result = await mergePdfs(payload.buffers, mergeOptions);
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
      case 'text-to-pdf': {
        if (typeof payload.text !== 'string') {
          throw new Error('Text to PDF operation requires a text string.');
        }
        const textOptions = (payload.options || payload.textOptions) as TextToPdfOptions | undefined;
        // Signal is omitted in worker: runs on genuinely synchronous fast path
        result = await textToPdf(payload.text, textOptions);
        break;
      }
      case 'reorder': {
        if (!payload.buffer) {
          throw new Error('Reorder operation requires a PDF buffer.');
        }
        if (!payload.pageOrder || payload.pageOrder.length === 0) {
          throw new Error('Reorder operation requires a page order sequence.');
        }
        const reorderOptions = (payload.options || payload.reorderOptions) as ReorderOptions | undefined;
        result = await reorderPdfPages(payload.buffer, payload.pageOrder, reorderOptions);
        break;
      }
      case 'sign': {
        if (!payload.buffer) {
          throw new Error('Sign operation requires a PDF buffer.');
        }
        if (!payload.signatureBytes) {
          throw new Error('Sign operation requires a signature image.');
        }
        const signOptions = (payload.options || payload.signOptions) as SignOptions | undefined;
        result = await signPdf(payload.buffer, payload.signatureBytes, signOptions);
        break;
      }
      case 'protect': {
        if (!payload.buffer) {
          throw new Error('Protect operation requires a PDF buffer.');
        }
        const protectOptions = (payload.options || payload.protectOptions) as ProtectPdfOptions;
        result = await protectPdf(payload.buffer, protectOptions);
        break;
      }
      case 'unlock': {
        if (!payload.buffer) {
          throw new Error('Unlock operation requires a PDF buffer.');
        }
        const unlockOptions = (payload.options || payload.unlockOptions) as UnlockPdfOptions;
        result = await unlockPdf(payload.buffer, unlockOptions);
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
