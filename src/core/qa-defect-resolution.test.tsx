import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import { extractTextFromPdf } from './extract-text';
import CompressTool from '../tools/modules/CompressTool';
import { executeBatchCompression } from '../tools/modules/compress/batchCompress';
import ToolResultCard from '../pages/tool/ToolResultCard';
import { getToolById } from '../tools/registry';
import type { StagedFile } from '../tools/types';
import { pdfProcessingService } from './index';

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

async function createScannedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(TEST_JPEG_1X1);
  const page = doc.addPage([300, 400]);
  page.drawImage(img, { x: 50, y: 50, width: 200, height: 200 });
  return await doc.save();
}

async function createEmptyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  return await doc.save();
}

async function createValidTextPdf(text = 'InTabPDF Text Document'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  page.drawText(text, { x: 50, y: 350, size: 12 });
  return await doc.save();
}

describe('Post-Sprint QA Defect Resolution Test Suite', () => {
  const compressToolDef = getToolById('compress')!;
  const extractToolDef = getToolById('extract-text')!;

  describe('FIX A — Extract Text: Scanned PDF vs Empty PDF Distinction', () => {
    it('reliably detects scanned image PDF with 0 words and flags hasImages: true', async () => {
      const scannedPdfBytes = await createScannedPdf();
      const result = await extractTextFromPdf(scannedPdfBytes);

      expect(result.wordCount).toBe(0);
      expect(result.charCount).toBe(0);
      expect(result.hasImages).toBe(true);
    });

    it('reliably detects truly empty PDF with 0 words and flags hasImages: false', async () => {
      const emptyPdfBytes = await createEmptyPdf();
      const result = await extractTextFromPdf(emptyPdfBytes);

      expect(result.wordCount).toBe(0);
      expect(result.charCount).toBe(0);
      expect(result.hasImages).toBe(false);
    });

    it('displays OCR limitation notice in ToolResultCard for scanned image PDF', () => {
      const dummyFile: StagedFile = {
        id: 'scan-1',
        name: 'scan.pdf',
        size: 15000,
        bytes: new Uint8Array(10),
      };

      const html = renderToString(
        <ToolResultCard
          tool={extractToolDef}
          stagedFiles={[dummyFile]}
          outputBytes={new Uint8Array(0)}
          extraState={{ hasImages: true, isScanned: true, wordCount: 0 }}
          customFileName=""
          onCustomFileNameChange={() => {}}
          defaultBaseName="extracted-text"
          outputExtension=".txt"
          isSaved={false}
          isZipOutput={false}
          platformType="web"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      expect(html).toContain('No text extracted');
      expect(html).toContain('Image-based PDF (OCR required)');
      expect(html).toContain('Optical Character Recognition (OCR)');
      expect(html).toContain('not currently supported');
      expect(html).toContain('No text to save');
      // Disabled copy text button
      expect(html).toContain('Copy text');
      expect(html).toContain('disabled');
    });

    it('displays empty document notice in ToolResultCard for truly empty PDF without claiming it is scanned', () => {
      const dummyFile: StagedFile = {
        id: 'blank-1',
        name: 'blank.pdf',
        size: 1200,
        bytes: new Uint8Array(10),
      };

      const html = renderToString(
        <ToolResultCard
          tool={extractToolDef}
          stagedFiles={[dummyFile]}
          outputBytes={new Uint8Array(0)}
          extraState={{ hasImages: false, isScanned: false, wordCount: 0 }}
          customFileName=""
          onCustomFileNameChange={() => {}}
          defaultBaseName="extracted-text"
          outputExtension=".txt"
          isSaved={false}
          isZipOutput={false}
          platformType="web"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      expect(html).toContain('No text extracted');
      expect(html).toContain('No text found in document');
      expect(html).toContain('does not contain any selectable text characters');
      expect(html).not.toContain('Image-based PDF');
      expect(html).not.toContain('Optical Character Recognition');
      expect(html).toContain('No text to save');
    });
  });

  describe('FIX B — Multiple-File Compression Failure Isolation & Progress', () => {
    it('isolates single failure among valid files, includes only valid files in ZIP, and reports batchStats', async () => {
      const validPdf1 = await createValidTextPdf('File 1 text');
      const validPdf2 = await createValidTextPdf('File 2 text');
      const corruptPdf = new Uint8Array([0x00, 0x11, 0x22, 0x33]); // Invalid header

      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'document-1.pdf', size: validPdf1.byteLength, bytes: validPdf1 },
        { id: 'f2', name: 'corrupted.pdf', size: corruptPdf.byteLength, bytes: corruptPdf },
        { id: 'f3', name: 'document-2.pdf', size: validPdf2.byteLength, bytes: validPdf2 },
      ];

      const extraState: Record<string, unknown> = {};
      const onExtraStateChange = (key: string, value: unknown) => {
        extraState[key] = value;
      };

      const progressMessages: string[] = [];
      const updateMessage = (msg: string) => progressMessages.push(msg);

      const zipBytes = await executeBatchCompression(
        stagedFiles,
        {
          mode: 'recommended',
          corePreset: 'recommended',
          downsampleImages: true,
          stripMetadata: true,
        },
        {
          updateMessage,
          onExtraStateChange,
        }
      );

      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes.byteLength).toBeGreaterThan(0);

      // Verify dynamic progress reporting
      expect(progressMessages).toContain('Compressing file 1 of 3…');
      expect(progressMessages).toContain('Compressing file 2 of 3…');
      expect(progressMessages).toContain('Compressing file 3 of 3…');

      // Verify batchStats
      const batchStats = extraState.batchStats as {
        total: number;
        successCount: number;
        failureCount: number;
        failures: { fileName: string; reason: string }[];
      };
      expect(batchStats).toBeDefined();
      expect(batchStats.total).toBe(3);
      expect(batchStats.successCount).toBe(2);
      expect(batchStats.failureCount).toBe(1);
      expect(batchStats.failures[0].fileName).toBe('corrupted.pdf');

      // Verify successful original bytes excludes the failed file
      expect(extraState.successfulOriginalBytes).toBe(validPdf1.byteLength + validPdf2.byteLength);

      // Verify ToolResultCard rendering for partial failure
      const html = renderToString(
        <ToolResultCard
          tool={compressToolDef}
          stagedFiles={stagedFiles}
          outputBytes={zipBytes}
          extraState={extraState}
          customFileName=""
          onCustomFileNameChange={() => {}}
          defaultBaseName="compressed-documents"
          outputExtension=".zip"
          isSaved={false}
          isZipOutput={true}
          platformType="web"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      expect(html).toContain('Compressed 2 of 3 files');
      expect(html).toContain('files could not be compressed');
      expect(html).toContain('successfully compressed and included in the ZIP');
      expect(html).toContain('corrupted.pdf');
      expect(html).toContain('Save ZIP');
    });

    it('handles first file failing while subsequent files succeed', async () => {
      const validPdf = await createValidTextPdf('File 2 text');
      const corruptPdf = new Uint8Array([0x99, 0x88]);

      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'bad-first.pdf', size: corruptPdf.byteLength, bytes: corruptPdf },
        { id: 'f2', name: 'good-second.pdf', size: validPdf.byteLength, bytes: validPdf },
      ];

      const extraState: Record<string, unknown> = {};
      const zipBytes = await executeBatchCompression(
        stagedFiles,
        {
          mode: 'recommended',
          corePreset: 'recommended',
          downsampleImages: true,
          stripMetadata: true,
        },
        {
          onExtraStateChange: (k, v) => {
            extraState[k] = v;
          },
        }
      );

      expect(zipBytes.byteLength).toBeGreaterThan(0);

      const stats = extraState.batchStats as { successCount: number; failureCount: number };
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(1);
      expect(extraState.successfulOriginalBytes).toBe(validPdf.byteLength);
    });

    it('handles last file failing while preceding files succeed', async () => {
      const validPdf = await createValidTextPdf('File 1 text');
      const corruptPdf = new Uint8Array([0x99, 0x88]);

      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'good-first.pdf', size: validPdf.byteLength, bytes: validPdf },
        { id: 'f2', name: 'bad-last.pdf', size: corruptPdf.byteLength, bytes: corruptPdf },
      ];

      const extraState: Record<string, unknown> = {};
      const zipBytes = await executeBatchCompression(
        stagedFiles,
        {
          mode: 'recommended',
          corePreset: 'recommended',
          downsampleImages: true,
          stripMetadata: true,
        },
        {
          onExtraStateChange: (k, v) => {
            extraState[k] = v;
          },
        }
      );

      expect(zipBytes.byteLength).toBeGreaterThan(0);

      const stats = extraState.batchStats as { successCount: number; failureCount: number };
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(1);
      expect(extraState.successfulOriginalBytes).toBe(validPdf.byteLength);
    });

    it('throws error and does not produce empty ZIP when all files fail', async () => {
      const corrupt1 = new Uint8Array([0x11, 0x22]);
      const corrupt2 = new Uint8Array([0x33, 0x44]);

      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'bad1.pdf', size: corrupt1.byteLength, bytes: corrupt1 },
        { id: 'f2', name: 'bad2.pdf', size: corrupt2.byteLength, bytes: corrupt2 },
      ];

      await expect(
        executeBatchCompression(stagedFiles, {
          mode: 'recommended',
          corePreset: 'recommended',
          downsampleImages: true,
          stripMetadata: true,
        })
      ).rejects.toThrow('All 2 files failed to compress');
    });

    it('succeeds cleanly when all files succeed and handles duplicate filenames safely', async () => {
      const validPdf1 = await createValidTextPdf('Doc A');
      const validPdf2 = await createValidTextPdf('Doc B');

      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'statement.pdf', size: validPdf1.byteLength, bytes: validPdf1 },
        { id: 'f2', name: 'statement.pdf', size: validPdf2.byteLength, bytes: validPdf2 },
      ];

      const extraState: Record<string, unknown> = {};
      const zipBytes = await executeBatchCompression(
        stagedFiles,
        {
          mode: 'recommended',
          corePreset: 'recommended',
          downsampleImages: true,
          stripMetadata: true,
        },
        {
          onExtraStateChange: (k, v) => {
            extraState[k] = v;
          },
        }
      );

      expect(zipBytes.byteLength).toBeGreaterThan(0);

      const stats = extraState.batchStats as { successCount: number; failureCount: number };
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(0);

      const html = renderToString(
        <ToolResultCard
          tool={compressToolDef}
          stagedFiles={stagedFiles}
          outputBytes={zipBytes}
          extraState={extraState}
          customFileName=""
          onCustomFileNameChange={() => {}}
          defaultBaseName="compressed-documents"
          outputExtension=".zip"
          isSaved={false}
          isZipOutput={true}
          platformType="web"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      expect(html).toContain('Compressed 2 files!');
      expect(html).not.toContain('could not be compressed');
    });

    it('preserves single-file compression returning PDF directly without ZIP', async () => {
      const validPdf = await createValidTextPdf('Single file test');
      const singleCompressed = await pdfProcessingService.execute('compress', {
        buffer: validPdf,
        options: {
          preset: 'recommended',
          downsampleImages: true,
          stripMetadata: true,
        },
      });

      expect(singleCompressed).toBeInstanceOf(Uint8Array);
      // Valid PDF starts with %PDF
      expect(singleCompressed[0]).toBe(0x25);
      expect(singleCompressed[1]).toBe(0x50);
      expect(singleCompressed[2]).toBe(0x44);
      expect(singleCompressed[3]).toBe(0x46);
    });

    it('renders CompressTool component UI with primary button and options', () => {
      const dummyFile: StagedFile = {
        id: '1',
        name: 'sample.pdf',
        size: 5000,
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      };

      const html = renderToString(
        <CompressTool
          tool={compressToolDef}
          stagedFiles={[dummyFile]}
          optionsState={{ downsample: true, 'strip-meta': true }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
        />
      );

      expect(html).toContain('Recommended');
      expect(html).toContain('Compress PDF');
      expect(html).toContain('Downsample large photos');
      expect(html).toContain('Strip metadata');
    });
  });
});
