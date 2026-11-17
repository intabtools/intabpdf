// Type definitions for PDF to Images conversion options, presets, and results.

export type ImageFormat = 'png' | 'jpeg';

export type ResolutionPreset = 1 | 2 | 3; // 1x Standard (72 DPI), 2x High (144 DPI), 3x Very High (216 DPI)

export interface ResolutionOption {
  scale: ResolutionPreset;
  label: string;
  description: string;
  dpi: number;
}

export const RESOLUTION_PRESETS: ResolutionOption[] = [
  { scale: 1, label: 'Standard (1×)', description: '72 DPI • Fast & low memory', dpi: 72 },
  { scale: 2, label: 'High (2×)', description: '144 DPI • Sharp for reading & sharing', dpi: 144 },
  { scale: 3, label: 'Very High (3×)', description: '216 DPI • Print-quality & ultra detail', dpi: 216 },
];

export interface JpegQualityOption {
  quality: number;
  label: string;
}

export const JPEG_QUALITY_PRESETS: JpegQualityOption[] = [
  { quality: 0.75, label: 'Compact (75%)' },
  { quality: 0.85, label: 'High (85%)' },
  { quality: 0.95, label: 'Maximum (95%)' },
];

/**
 * Safe cumulative memory threshold (500 MB) for in-memory rasterized image buffers.
 * Prevents browser tab heap crashes during large multi-page export into a contiguous ZIP archive.
 */
export const MAX_CUMULATIVE_BYTES = 500 * 1024 * 1024;

/**
 * Advisory page-count threshold for Very High (3x / 216 DPI) resolution.
 * Displays an informational advisory about memory and processing overhead.
 */
export const LARGE_BATCH_THRESHOLD_3X = 30;

export interface ConversionProgress {
  current: number;
  total: number;
  pageNumber: number;
  percent: number;
}

export interface PdfToImagesOptions {
  format: ImageFormat;
  scale: ResolutionPreset;
  jpegQuality?: number;
  pages: number[];
  signal?: AbortSignal;
  onProgress?: (progress: ConversionProgress) => void;
  maxCumulativeBytes?: number;
}

export interface ConvertedPageImage {
  pageNumber: number;
  fileName: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface PdfToImagesResult {
  outputBytes: Uint8Array;
  isZip: boolean;
  outputExtension: '.png' | '.jpg' | '.zip';
  pageCount: number;
  format: ImageFormat;
  scale: ResolutionPreset;
  singleFileName?: string;
  images: ConvertedPageImage[];
}
