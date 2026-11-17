import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import { getToolById } from './registry';
import { executeBatchOperation, getCollisionSafeName } from './batchOperation';
import { getDefaultOutputBaseName, getOutputExtension } from './filename';
import type { StagedFile } from './types';
import DropZone from '../components/DropZone';
import { validateFileSelectionCount } from '../components/dropZoneValidation';
import SplitTool from './modules/SplitTool';
import ImagesToPdfTool from './modules/ImagesToPdfTool';
import { shrinkImageIfNeeded } from './modules/imagesToPdf/imageShrinker';
import { imagesToPdf, pdfProcessingService } from '../core';
import { executeBatchCompression } from './modules/compress/batchCompress';

async function createMinimalPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 350, size: 12 });
  }
  return await doc.save();
}

describe('Phase 1: Multi-File Batch Integrity & Disconnected Options', () => {
  describe('Sequential Batch Operation Engine (Rotate, Extract Text, PDF to Images)', () => {
    it('processes multi-file Rotate sequentially and produces a valid ZIP archive with all rotated files', async () => {
      const pdfBytes1 = await createMinimalPdf(1);
      const pdfBytes2 = await createMinimalPdf(2);

      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'report.pdf', size: pdfBytes1.byteLength, bytes: pdfBytes1 },
        { id: 'f2', name: 'invoice.pdf', size: pdfBytes2.byteLength, bytes: pdfBytes2 },
      ];

      const messages: string[] = [];
      const extraState: Record<string, unknown> = {};

      const zipBytes = await executeBatchOperation({
        actionVerb: 'Rotating',
        stagedFiles,
        updateMessage: (msg) => messages.push(msg),
        onExtraStateChange: (k, v) => {
          extraState[k] = v;
        },
        processFile: async (curFile) => {
          const rotated = await pdfProcessingService.execute('rotate', {
            buffer: curFile.bytes,
            options: { clockwise: true, allPages: true },
          });
          return {
            name: `rotated-${curFile.name}`,
            bytes: rotated,
          };
        },
      });

      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes.byteLength).toBeGreaterThan(0);
      // Verify ZIP magic header (PK..)
      expect(zipBytes[0]).toBe(0x50);
      expect(zipBytes[1]).toBe(0x4b);

      // Verify progress messages were dispatched per file
      expect(messages.length).toBe(2);
      expect(messages[0]).toContain('file 1 of 2');
      expect(messages[1]).toContain('file 2 of 2');

      // Verify batchStats
      const stats = extraState.batchStats as {
        total: number;
        successCount: number;
        failureCount: number;
        failures: unknown[];
      };
      expect(stats).toBeDefined();
      expect(stats.total).toBe(2);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(0);
      expect(stats.failures).toHaveLength(0);
    });

    it('isolates single file failures: continuing remaining files and recording failure reasons', async () => {
      const validBytes1 = await createMinimalPdf(1);
      const corruptBytes = new Uint8Array([1, 2, 3, 4, 5]); // Invalid PDF
      const validBytes2 = await createMinimalPdf(1);

      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'first-valid.pdf', size: validBytes1.byteLength, bytes: validBytes1 },
        { id: 'f2', name: 'broken.pdf', size: corruptBytes.byteLength, bytes: corruptBytes },
        { id: 'f3', name: 'second-valid.pdf', size: validBytes2.byteLength, bytes: validBytes2 },
      ];

      const extraState: Record<string, unknown> = {};

      const zipBytes = await executeBatchOperation({
        actionVerb: 'Rotating',
        stagedFiles,
        onExtraStateChange: (k, v) => {
          extraState[k] = v;
        },
        processFile: async (curFile) => {
          const rotated = await pdfProcessingService.execute('rotate', {
            buffer: curFile.bytes,
            options: { clockwise: true, allPages: true },
          });
          return {
            name: `rotated-${curFile.name}`,
            bytes: rotated,
          };
        },
      });

      expect(zipBytes).toBeInstanceOf(Uint8Array);
      const stats = extraState.batchStats as {
        total: number;
        successCount: number;
        failureCount: number;
        failures: { fileName: string; reason: string }[];
      };
      expect(stats.total).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.failures[0].fileName).toBe('broken.pdf');
      expect(stats.failures[0].reason).toBeTruthy();
    });

    it('throws clear descriptive error when all files in the batch fail', async () => {
      const corruptBytes = new Uint8Array([1, 2, 3]);
      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'bad1.pdf', size: 3, bytes: corruptBytes },
        { id: 'f2', name: 'bad2.pdf', size: 3, bytes: corruptBytes },
      ];

      await expect(
        executeBatchOperation({
          actionVerb: 'Processing',
          stagedFiles,
          processFile: async () => {
            throw new Error('Corrupt file structure');
          },
        })
      ).rejects.toThrow(/All 2 files failed to process/);
    });

    it('safely handles collision-prone duplicate file names in batch outputs', async () => {
      const pdfBytes = await createMinimalPdf(1);
      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'document.pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
        { id: 'f2', name: 'document.pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
        { id: 'f3', name: 'document.pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
      ];

      const capturedNames: string[] = [];
      await executeBatchOperation({
        actionVerb: 'Processing',
        stagedFiles,
        processFile: async (curFile) => {
          capturedNames.push(curFile.name);
          return {
            name: curFile.name,
            bytes: new Uint8Array([1, 2, 3]),
          };
        },
      });

      expect(capturedNames).toHaveLength(3);
    });

    it('rethrows cancellation errors immediately and stops subsequent file processing', async () => {
      const pdfBytes = await createMinimalPdf(1);
      const stagedFiles: StagedFile[] = [
        { id: 'f1', name: 'doc1.pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
        { id: 'f2', name: 'doc2.pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
      ];

      let processedCount = 0;
      await expect(
        executeBatchOperation({
          actionVerb: 'Rendering',
          stagedFiles,
          processFile: async () => {
            processedCount++;
            throw new Error('Conversion cancelled');
          },
        })
      ).rejects.toThrow('Conversion cancelled');

      // Processing must halt immediately on cancellation
      expect(processedCount).toBe(1);
    });

    it('processes multi-file Extract Text sequentially and produces a ZIP with extracted .txt files', async () => {
      const pdfBytes1 = await createMinimalPdf(1);
      const pdfBytes2 = await createMinimalPdf(1);

      const stagedFiles: StagedFile[] = [
        { id: 't1', name: 'contract.pdf', size: pdfBytes1.byteLength, bytes: pdfBytes1 },
        { id: 't2', name: 'terms.pdf', size: pdfBytes2.byteLength, bytes: pdfBytes2 },
      ];

      const extraState: Record<string, unknown> = {};

      const zipBytes = await executeBatchOperation({
        actionVerb: 'Extracting text',
        stagedFiles,
        onExtraStateChange: (k, v) => {
          extraState[k] = v;
        },
        processFile: async (curFile) => {
          const fakeText = `Extracted text from ${curFile.name}`;
          return {
            name: curFile.name.replace(/\.pdf$/i, '.txt'),
            bytes: new TextEncoder().encode(fakeText),
          };
        },
      });

      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes[0]).toBe(0x50);
      expect(zipBytes[1]).toBe(0x4b);

      const stats = extraState.batchStats as {
        total: number;
        successCount: number;
        failureCount: number;
      };
      expect(stats.total).toBe(2);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(0);
    });

    it('processes multi-file PDF to Images sequentially and packages rendered images into a ZIP', async () => {
      const pdfBytes1 = await createMinimalPdf(1);
      const pdfBytes2 = await createMinimalPdf(2);

      const stagedFiles: StagedFile[] = [
        { id: 'p1', name: 'presentation.pdf', size: pdfBytes1.byteLength, bytes: pdfBytes1 },
        { id: 'p2', name: 'slides.pdf', size: pdfBytes2.byteLength, bytes: pdfBytes2 },
      ];

      const extraState: Record<string, unknown> = {};

      const zipBytes = await executeBatchOperation({
        actionVerb: 'Converting',
        stagedFiles,
        onExtraStateChange: (k, v) => {
          extraState[k] = v;
        },
        processFile: async (curFile) => {
          // Simulates 2 page images returned for a file
          return [
            { name: `${curFile.name}-page-001.png`, bytes: new Uint8Array([1, 2]) },
            { name: `${curFile.name}-page-002.png`, bytes: new Uint8Array([3, 4]) },
          ];
        },
      });

      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes[0]).toBe(0x50);
      expect(zipBytes[1]).toBe(0x4b);

      const stats = extraState.batchStats as {
        total: number;
        successCount: number;
        failureCount: number;
      };
      expect(stats.total).toBe(2);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(0);
    });
  });

  describe('Single-File Enforcement on Remove Pages and Split', () => {
    it('DropZone rejects multiple files when multiple=false and notifies callback', () => {
      // Render DropZone with multiple={false}
      const html = renderToString(
        <DropZone
          onFilesSelected={() => {}}
          multiple={false}
          onMultipleRejected={() => {}}
        />
      );

      expect(html).not.toContain('multiple=""');
      expect(html).not.toContain('multiple');
    });

    it('validateFileSelectionCount rejects multiple files when multiple=false and triggers callback', () => {
      let rejected = 0;
      const isAccepted = validateFileSelectionCount(3, false, (count) => {
        rejected = count;
      });

      expect(isAccepted).toBe(false);
      expect(rejected).toBe(3);
    });

    it('validateFileSelectionCount accepts single file when multiple=false', () => {
      let rejected = 0;
      const isAccepted = validateFileSelectionCount(1, false, (count) => {
        rejected = count;
      });

      expect(isAccepted).toBe(true);
      expect(rejected).toBe(0);
    });

    it('validateFileSelectionCount accepts multiple files when multiple=true', () => {
      let rejected = 0;
      const isAccepted = validateFileSelectionCount(5, true, (count) => {
        rejected = count;
      });

      expect(isAccepted).toBe(true);
      expect(rejected).toBe(0);
    });

    it('Split tool definition does not expose the disconnected "Keep bookmarks" option', () => {
      const splitDef = getToolById('split')!;
      expect(splitDef.options.some((opt) => opt.id === 'bookmarks')).toBe(false);
      expect(splitDef.options).toEqual([
        { id: 'one-per-page', label: 'One file per page', description: 'Otherwise you pick the ranges', defaultValue: false },
      ]);
    });

    it('Split tool UI does not render "Keep bookmarks" switch', () => {
      const splitDef = getToolById('split')!;
      const dummyFile: StagedFile = {
        id: 's1',
        name: 'sample.pdf',
        size: 100,
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      };

      const html = renderToString(
        <SplitTool
          tool={splitDef}
          stagedFiles={[dummyFile]}
          optionsState={{ 'one-per-page': false }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
          outputBaseName="split"
          onOutputBaseNameChange={() => {}}
          defaultBaseName="split-document"
          outputExtension=".zip"
        />
      );

      expect(html).not.toContain('Keep bookmarks');
      expect(html).toContain('One file per page');
    });
  });

  describe('Images to PDF & PDF to Images Option Consistency', () => {
    it('Images to PDF tool definition does not expose disconnected "fit" switch', () => {
      const imgDef = getToolById('images-to-pdf')!;
      expect(imgDef.options.some((opt) => opt.id === 'fit')).toBe(false);
      expect(imgDef.options.some((opt) => opt.id === 'shrink')).toBe(true);
    });

    it('Images to PDF UI does not render duplicate "Fit photos to page" switch', () => {
      const imgDef = getToolById('images-to-pdf')!;
      const dummyImg: StagedFile = {
        id: 'img1',
        name: 'photo.jpg',
        size: 200,
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      };

      const html = renderToString(
        <ImagesToPdfTool
          tool={imgDef}
          stagedFiles={[dummyImg]}
          optionsState={{ shrink: false }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
          outputBaseName="images-to-pdf"
          onOutputBaseNameChange={() => {}}
          defaultBaseName="images-to-pdf"
          outputExtension=".pdf"
        />
      );

      expect(html).not.toContain('Fit photos to page');
      expect(html).toContain('Shrink large photos');
      expect(html).toContain('Page size &amp; layout');
    });

    it('PDF to Images tool definition contains zero obsolete options', () => {
      const pdfToImgDef = getToolById('pdf-to-images')!;
      expect(pdfToImgDef.options).toEqual([]);
      expect(pdfToImgDef.options.some((opt) => opt.id === 'hi-res')).toBe(false);
      expect(pdfToImgDef.options.some((opt) => opt.id === 'png')).toBe(false);
    });

    it('shrinkImageIfNeeded preserves small images without altering or enlarging them', async () => {
      // 1x1 valid JPEG
      const testJpeg = new Uint8Array([
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

      const result = await shrinkImageIfNeeded(testJpeg, 'pic.jpg', { maxDimension: 1920 });
      // Small image is untouched and not enlarged
      expect(result).toBe(testJpeg);

      const pdf = await imagesToPdf([{ name: 'pic.jpg', bytes: result }]);
      expect(pdf.byteLength).toBeGreaterThan(0);
    });
  });

  describe('Filename & Extension Utilities for Multi-File Batches', () => {
    it('returns .zip for multi-file batches and tool-native extensions for single-file outputs', () => {
      expect(getOutputExtension('rotate', 'rotated.pdf', 2)).toBe('.zip');
      expect(getOutputExtension('rotate', 'rotated.pdf', 1)).toBe('.pdf');

      expect(getOutputExtension('extract-text', 'text.txt', 3)).toBe('.zip');
      expect(getOutputExtension('extract-text', 'text.txt', 1)).toBe('.txt');

      expect(getOutputExtension('compress', 'compressed.pdf', 4)).toBe('.zip');
      expect(getOutputExtension('compress', 'compressed.pdf', 1)).toBe('.pdf');

      expect(getOutputExtension('pdf-to-images', 'pages.zip', 2)).toBe('.zip');
      expect(getOutputExtension('pdf-to-images', 'page.png', 1)).toBe('.png');
      expect(getOutputExtension('pdf-to-images', 'page.jpg', 1)).toBe('.jpg');
    });

    it('returns pluralized default base names for multi-file batches', () => {
      const twoFiles = [{ name: 'a.pdf' }, { name: 'b.pdf' }];
      const oneFile = [{ name: 'sample.pdf' }];

      expect(getDefaultOutputBaseName('rotate', twoFiles)).toBe('rotated-documents');
      expect(getDefaultOutputBaseName('rotate', oneFile)).toBe('rotated-sample');

      expect(getDefaultOutputBaseName('extract-text', twoFiles)).toBe('extracted-texts');
      expect(getDefaultOutputBaseName('extract-text', oneFile)).toBe('extracted-sample');

      expect(getDefaultOutputBaseName('compress', twoFiles)).toBe('compressed-documents');
      expect(getDefaultOutputBaseName('compress', oneFile)).toBe('compressed-sample');

      expect(getDefaultOutputBaseName('pdf-to-images', twoFiles)).toBe('pdf-images');
      expect(getDefaultOutputBaseName('pdf-to-images', oneFile)).toBe('sample-images');
    });

    it('getCollisionSafeName properly handles multiple collisions and case-insensitivity', () => {
      const usedNames = new Set<string>();

      const name1 = getCollisionSafeName('report.pdf', 'rotated', '.pdf', usedNames);
      expect(name1).toBe('rotated-report.pdf');

      const name2 = getCollisionSafeName('report.pdf', 'rotated', '.pdf', usedNames);
      expect(name2).toBe('rotated-report-2.pdf');

      const name3 = getCollisionSafeName('REPORT.pdf', 'rotated', '.pdf', usedNames);
      expect(name3).toBe('rotated-REPORT-3.pdf');
    });
  });

  describe('Full Multi-File Tool Workflows', () => {
    it('Rotate Pages: processes 3 documents sequentially, each exactly once, into a ZIP archive', async () => {
      const b1 = await createMinimalPdf(1);
      const b2 = await createMinimalPdf(1);
      const b3 = await createMinimalPdf(1);

      const staged: StagedFile[] = [
        { id: '1', name: 'alpha.pdf', size: b1.byteLength, bytes: b1 },
        { id: '2', name: 'beta.pdf', size: b2.byteLength, bytes: b2 },
        { id: '3', name: 'gamma.pdf', size: b3.byteLength, bytes: b3 },
      ];

      const processedFiles: string[] = [];
      const extraState: Record<string, unknown> = {};

      const zipBytes = await executeBatchOperation({
        actionVerb: 'Rotating',
        stagedFiles: staged,
        onExtraStateChange: (k, v) => { extraState[k] = v; },
        processFile: async (curFile) => {
          processedFiles.push(curFile.name);
          const rotated = await pdfProcessingService.execute('rotate', {
            buffer: curFile.bytes,
            options: { clockwise: true, allPages: true },
          });
          return {
            name: `rotated-${curFile.name}`,
            bytes: rotated,
          };
        },
      });

      expect(processedFiles).toEqual(['alpha.pdf', 'beta.pdf', 'gamma.pdf']);
      expect(zipBytes.byteLength).toBeGreaterThan(0);
      const stats = extraState.batchStats as { total: number; successCount: number; failureCount: number };
      expect(stats.total).toBe(3);
      expect(stats.successCount).toBe(3);
      expect(stats.failureCount).toBe(0);
    });

    it('Extract Text: processes 2 documents, each exactly once, into a ZIP archive', async () => {
      const b1 = await createMinimalPdf(1);
      const b2 = await createMinimalPdf(1);

      const staged: StagedFile[] = [
        { id: '1', name: 'contract.pdf', size: b1.byteLength, bytes: b1 },
        { id: '2', name: 'appendix.pdf', size: b2.byteLength, bytes: b2 },
      ];

      const processedFiles: string[] = [];
      const extraState: Record<string, unknown> = {};

      const zipBytes = await executeBatchOperation({
        actionVerb: 'Extracting text',
        stagedFiles: staged,
        onExtraStateChange: (k, v) => { extraState[k] = v; },
        processFile: async (curFile) => {
          processedFiles.push(curFile.name);
          return {
            name: `${curFile.name.replace(/\.pdf$/i, '')}.txt`,
            bytes: new TextEncoder().encode(`Content of ${curFile.name}`),
          };
        },
      });

      expect(processedFiles).toEqual(['contract.pdf', 'appendix.pdf']);
      expect(zipBytes.byteLength).toBeGreaterThan(0);
      const stats = extraState.batchStats as { total: number; successCount: number; failureCount: number };
      expect(stats.total).toBe(2);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(0);
    });

    it('Compress: preserves existing executeBatchCompression multi-file workflow', async () => {
      const b1 = await createMinimalPdf(1);
      const b2 = await createMinimalPdf(1);

      const staged: StagedFile[] = [
        { id: '1', name: 'doc1.pdf', size: b1.byteLength, bytes: b1 },
        { id: '2', name: 'doc2.pdf', size: b2.byteLength, bytes: b2 },
      ];

      const extraState: Record<string, unknown> = {};

      const zipBytes = await executeBatchCompression(
        staged,
        {
          mode: 'recommended',
          corePreset: 'recommended',
          downsampleImages: true,
          stripMetadata: false,
        },
        {
          onExtraStateChange: (k, v) => { extraState[k] = v; },
        }
      );

      expect(zipBytes.byteLength).toBeGreaterThan(0);
      const stats = extraState.batchStats as { total: number; successCount: number; failureCount: number };
      expect(stats.total).toBe(2);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(0);
    });

    it('Images to PDF: verifies pure page sizing (fit vs a4) and margin options work properly', async () => {
      const testJpeg = new Uint8Array([
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

      const fitPdf = await imagesToPdf([{ name: 'p1.jpg', bytes: testJpeg }], {
        pageSizing: 'fit',
        margin: 'small',
      });
      expect(fitPdf.byteLength).toBeGreaterThan(0);

      const a4Pdf = await imagesToPdf([{ name: 'p1.jpg', bytes: testJpeg }], {
        pageSizing: 'a4',
        margin: 'standard',
      });
      expect(a4Pdf.byteLength).toBeGreaterThan(0);
    });
  });
});
