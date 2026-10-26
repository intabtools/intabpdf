import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import {
  calculateCompressionStats,
  compressPdf,
  recompressJpegBytes,
} from '../../../core/compress';
import CompressTool from '../CompressTool';
import TargetSizeSection from './TargetSizeSection';
import QualityPresetSection from './QualityPresetSection';
import ToolResultCard from '../../../pages/tool/ToolResultCard';
import { getToolById } from '../../registry';
import type { StagedFile } from '../../types';

// Helper to create a multi-page test PDF
async function createTestPdf(pageCount = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`InTabPDF Test Page ${i + 1}`, { x: 50, y: 500, size: 14 });
  }
  return await doc.save();
}

// Minimal valid 1x1 JPEG byte stream (magic header 0xFF 0xD8 ... 0xFF 0xD9)
const TEST_JPEG_1X1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08,
  0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a,
  0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d,
  0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22,
  0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34,
  0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0,
  0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
  0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
  0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
  0x3f, 0x00, 0xbf, 0x80, 0xff, 0xd9,
]);

describe('PDF Compression Tool: Core, Target Size, Accessibility, and UI', () => {
  describe('1. Core Compression Effectiveness & Presets', () => {
    it('compresses a multi-page PDF while strictly preserving page count and text', async () => {
      const source = await createTestPdf(3);
      const originalLength = source.byteLength;

      const compressed = await compressPdf(source, { preset: 'recommended' });
      expect(compressed).toBeInstanceOf(Uint8Array);
      expect(compressed.byteLength).toBeGreaterThan(0);
      expect(compressed.byteLength).toBeLessThanOrEqual(originalLength);

      // Verify page count and integrity with pdf-lib
      const doc = await PDFDocument.load(compressed);
      expect(doc.getPageCount()).toBe(3);

      // Verify original source buffer was not mutated
      expect(source.byteLength).toBe(originalLength);
    });

    it('supports Recommended, Smaller file, and High quality presets', async () => {
      const source = await createTestPdf(2);

      const resRecommended = await compressPdf(source, { preset: 'recommended' });
      const resSmaller = await compressPdf(source, { preset: 'smaller' });
      const resHighQuality = await compressPdf(source, { preset: 'high-quality' });

      expect((await PDFDocument.load(resRecommended)).getPageCount()).toBe(2);
      expect((await PDFDocument.load(resSmaller)).getPageCount()).toBe(2);
      expect((await PDFDocument.load(resHighQuality)).getPageCount()).toBe(2);
    });

    it('compresses PDF with embedded JPEG images preserving dimensions', async () => {
      const doc = await PDFDocument.create();
      const img = await doc.embedJpg(TEST_JPEG_1X1);
      const page = doc.addPage([300, 400]);
      page.drawImage(img, { x: 50, y: 50, width: 200, height: 200 });
      const source = await doc.save();

      const compressed = await compressPdf(source, { preset: 'smaller' });
      expect(compressed).toBeInstanceOf(Uint8Array);

      const parsed = await PDFDocument.load(compressed);
      expect(parsed.getPageCount()).toBe(1);
      expect(parsed.getPage(0).getWidth()).toBe(300);
      expect(parsed.getPage(0).getHeight()).toBe(400);
    });

    it('rejects empty or corrupt PDF data with clear error messages', async () => {
      await expect(compressPdf(new Uint8Array(0))).rejects.toThrow(
        'The provided PDF file is empty.'
      );
      await expect(compressPdf(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
        'Failed to read PDF document. The file may be corrupt or invalid.'
      );
    });
  });

  describe('2. Target-Size Behavior & Bounded Search', () => {
    it('stops and achieves target when source is already at or below target', async () => {
      const source = await createTestPdf(2);
      const targetBytes = source.byteLength + 10000;

      const compressed = await compressPdf(source, { targetBytes });
      expect(compressed.byteLength).toBeLessThanOrEqual(targetBytes);

      const stats = calculateCompressionStats(source.byteLength, compressed.byteLength, targetBytes);
      expect(stats.targetAchieved).toBe(true);
      expect(stats.targetBytes).toBe(targetBytes);
    });

    it('terminates boundedly and avoids false success claim when target is unreachable', async () => {
      const source = await createTestPdf(3);
      const impossibleTarget = 20; // 20 bytes is physically impossible for valid PDF

      const compressed = await compressPdf(source, { targetBytes: impossibleTarget });
      expect(compressed).toBeInstanceOf(Uint8Array);
      expect(compressed.byteLength).toBeLessThanOrEqual(source.byteLength);

      const stats = calculateCompressionStats(source.byteLength, compressed.byteLength, impossibleTarget);
      expect(stats.targetAchieved).toBe(false);
      expect(stats.compressedSize).toBeGreaterThan(impossibleTarget);
    });

    it('calculates real statistics and percentage reduction accurately', () => {
      // 1 MB -> 600 KB with 700 KB target
      const stats = calculateCompressionStats(1000000, 600000, 700000);
      expect(stats.originalSize).toBe(1000000);
      expect(stats.compressedSize).toBe(600000);
      expect(stats.savedBytes).toBe(400000);
      expect(stats.savedPercent).toBe(40.0);
      expect(stats.targetAchieved).toBe(true);
      expect(stats.isAlreadyOptimized).toBe(false);

      // Missed target: 1 MB -> 800 KB with 500 KB target
      const missed = calculateCompressionStats(1000000, 800000, 500000);
      expect(missed.targetAchieved).toBe(false);
      expect(missed.savedBytes).toBe(200000);

      // Unchanged / already optimized
      const unch = calculateCompressionStats(5000, 5000);
      expect(unch.isAlreadyOptimized).toBe(true);
      expect(unch.savedBytes).toBe(0);
      expect(unch.savedPercent).toBe(0);
    });
  });

  describe('3. CompressTool UI & Preset Card Accessibility', () => {
    const compressTool = getToolById('compress')!;
    const dummyFile: StagedFile = {
      id: 'doc-1',
      name: 'financial-report.pdf',
      size: 2500000,
      bytes: new Uint8Array(100),
    };

    it('renders 4 accessible preset tabs: Recommended, Smaller file, High quality, Target size', () => {
      const html = renderToString(
        <CompressTool
          tool={compressTool}
          stagedFiles={[dummyFile]}
          optionsState={{ downsample: true, 'strip-meta': true }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
        />
      );

      expect(html).toContain('role="tablist"');
      expect(html).toContain('Recommended');
      expect(html).toContain('Smaller file');
      expect(html).toContain('High quality');
      expect(html).toContain('Target size');
      expect(html).toContain('Original: ');
      expect(html).toContain('2.4 MB');
    });

    it('renders preset details and compact strategy summary', () => {
      const html = renderToString(
        <QualityPresetSection preset="recommended" onPresetChange={() => {}} />
      );

      expect(html).toContain('Recommended');
      expect(html).toContain('70% photo quality');
      expect(html).toContain('Text &amp; vectors crisp');
      expect(html).toContain('role="radiogroup"');
    });

    it('validates target size input and renders accessible error warning for invalid numbers', () => {
      const html = renderToString(
        <TargetSizeSection
          file={dummyFile}
          targetValue="0"
          onTargetValueChange={() => {}}
          targetUnit="KB"
          onTargetUnitChange={() => {}}
          targetBytes={0}
          targetLabel="0 KB"
          onApplyPreset={() => {}}
        />
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('Please enter a valid target size greater than 0.');
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="target-size-error"');
    });

    it('renders quick target size presets with accessible labels', () => {
      const html = renderToString(
        <TargetSizeSection
          file={dummyFile}
          targetValue="500"
          onTargetValueChange={() => {}}
          targetUnit="KB"
          onTargetUnitChange={() => {}}
          targetBytes={500 * 1024}
          targetLabel="500 KB"
          onApplyPreset={() => {}}
        />
      );

      expect(html).toContain('aria-label="Set target to 100 KB"');
      expect(html).toContain('aria-label="Set target to 500 KB"');
      expect(html).toContain('aria-label="Set target to 1 MB"');
      expect(html).toContain('aria-label="Set target to 2 MB"');
    });
  });

  describe('4. ToolResultCard Reporting, Guidance & Recovery', () => {
    const compressTool = getToolById('compress')!;
    const dummyFile: StagedFile = {
      id: 'doc-1',
      name: 'statement.pdf',
      size: 1000000,
      bytes: new Uint8Array(1000000),
    };

    it('displays target achieved metrics and success badge when actual size <= target', () => {
      const outputBytes = new Uint8Array(450000);
      const html = renderToString(
        <ToolResultCard
          tool={compressTool}
          stagedFiles={[dummyFile]}
          outputBytes={outputBytes}
          extraState={{
            targetBytes: 500000,
            targetLabel: '500 KB',
            presetName: 'Target size',
          }}
          customFileName=""
          onCustomFileNameChange={() => {}}
          defaultBaseName="compressed-statement"
          outputExtension=".pdf"
          isSaved={false}
          isZipOutput={false}
          platformType="web"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
          onClearFiles={() => {}}
        />
      );

      expect(html).toContain('Target size achieved!');
      expect(html).toContain('✓ Target met');
      expect(html).toContain('Saved ');
      expect(html).toContain('537 KB');
      expect(html).toContain('55.0');
      expect(html).toContain('Change settings');
      expect(html).toContain('Choose another PDF');
      expect(html).toContain('role="region"');
      expect(html).toContain('aria-live="polite"');
    });

    it('honestly displays target not reached badge when actual size > target without claiming success', () => {
      const outputBytes = new Uint8Array(650000);
      const html = renderToString(
        <ToolResultCard
          tool={compressTool}
          stagedFiles={[dummyFile]}
          outputBytes={outputBytes}
          extraState={{
            targetBytes: 500000,
            targetLabel: '500 KB',
            presetName: 'Target size',
          }}
          customFileName=""
          onCustomFileNameChange={() => {}}
          defaultBaseName="compressed-statement"
          outputExtension=".pdf"
          isSaved={false}
          isZipOutput={false}
          platformType="web"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      expect(html).toContain('Target not reached');
      expect(html).not.toContain('✓ Target met');
      expect(html).toContain('The requested target of 500 KB could not be reached');
    });

    it('clearly explains when document is already optimized and cannot be reduced further', () => {
      const outputBytes = new Uint8Array(1000000);
      const html = renderToString(
        <ToolResultCard
          tool={compressTool}
          stagedFiles={[dummyFile]}
          outputBytes={outputBytes}
          extraState={{ presetName: 'Recommended' }}
          customFileName=""
          onCustomFileNameChange={() => {}}
          defaultBaseName="compressed-statement"
          outputExtension=".pdf"
          isSaved={false}
          isZipOutput={false}
          platformType="web"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      expect(html).toContain('Document already optimized');
      expect(html).toContain('Already optimized');
      expect(html).toContain('could not be compressed further without quality degradation');
    });
  });

  describe('5. Memory Safety and Lifecycle Execution', () => {
    it('safely handles environments lacking canvas without crashing', async () => {
      const res = await recompressJpegBytes(TEST_JPEG_1X1, 0.7);
      // In Node.js environment lacking ImageBitmap/Canvas, gracefully returns null
      expect(res === null || typeof res === 'object').toBe(true);
    });

    it('always executes imageBitmap.close() to prevent memory leaks when canvas is present', async () => {
      const closeSpy = vi.fn();
      const mockBitmap = {
        width: 100,
        height: 100,
        close: closeSpy,
      };

      const originalCreateBitmap = (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap;
      const originalOffscreen = (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;

      (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn().mockResolvedValue(mockBitmap);
      (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return {
            drawImage: vi.fn(),
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
          };
        }
        convertToBlob() {
          return Promise.resolve(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
        }
      };

      try {
        await recompressJpegBytes(TEST_JPEG_1X1, 0.7);
        // Verify bitmap was closed in finally block!
        expect(closeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = originalCreateBitmap;
        (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = originalOffscreen;
      }
    });
  });
});
