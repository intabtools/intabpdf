// Central export hub for all pure PDF core operations and worker services.
export { formatBytes } from './formatBytes';
export { mergePdfs } from './merge';

export { rotatePdfPages } from './rotate';
export type { RotateOptions } from './rotate';

export { removePdfPages, parseRemovePageInput } from './remove-pages';
export type { RemovePagesOptions, ParsedRemovePagesResult } from './remove-pages';

export {
  splitPdfPages,
  getPdfPageCount,
  parsePageRanges,
  validatePageRanges,
} from './split';
export type {
  PageRange,
  SplitOptions,
  SplitOutput,
  SplitPdfResult,
  ParsedRangesResult,
} from './split';

export { createZip, crc32 } from './zip';
export type { ZipEntry } from './zip';

export {
  imagesToPdf,
  detectImageFormat,
  convertWebpToPng,
} from './images-to-pdf';
export type {
  InputImage,
  ImagesToPdfOptions,
  PageSizing,
  MarginPreset,
  ImageFormat,
} from './images-to-pdf';

export {
  compressPdf,
  calculateCompressionStats,
  recompressJpegBytes,
} from './compress';
export type {
  CompressionPreset,
  CompressOptions,
  CompressionStats,
} from './compress';

export { pdfProcessingService } from './worker/service';
export type { PdfOperation, OperationPayloads } from './worker/service';

