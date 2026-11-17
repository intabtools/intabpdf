// Central export hub for all pure PDF core operations and worker services.
export { formatBytes } from './formatBytes';
export { mergePdfs } from './merge';
export type { MergeOptions } from './merge';

export { extractTextFromPdf, formatPageTextContent } from './extract-text';
export type { ExtractTextOptions, ExtractTextResult } from './extract-text';

export { rotatePdfPages, parseRotatePageInput } from './rotate';
export type { RotateOptions, ParsedRotatePagesResult } from './rotate';

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
  analyzePdfDocument,
} from './compress';
export {
  undoPngPredictor,
  undoTiffPredictor,
  recompressRasterPixels,
} from './image-compression';
export type {
  CompressionPreset,
  CompressOptions,
  CompressionStats,
} from './compress';
export type {
  DocumentContentType,
  DocumentAnalysis,
  ImageStreamInfo,
} from './document-analysis';

export { pdfProcessingService } from './worker/service';
export type { PdfOperation, OperationPayloads } from './worker/service';
