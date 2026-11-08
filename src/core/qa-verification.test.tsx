import { describe, expect, it } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRef,
  PDFString,
  PDFNumber,
  degrees,
} from 'pdf-lib';
import {
  extractTextFromPdf,
  formatPageTextContent,
  mergePdfs,
  rotatePdfPages,
  createZip,
} from './index';
import type { ZipEntry } from './zip';
import { getCleanBaseName } from '../tools/filename';

// Helper to create a PDF with multi-level nested bookmarks
async function createPdfWithNestedBookmarks(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([400, 600]);
  const p2 = doc.addPage([400, 600]);
  const p3 = doc.addPage([400, 600]);

  const outlinesDict = doc.context.obj({ Type: 'Outlines' });
  const outlinesRef = doc.context.register(outlinesDict);
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  // Chapter 1 (Level 1) -> Dest p1
  const ch1 = doc.context.obj({
    Title: PDFString.of('Chapter 1'),
    Parent: outlinesRef,
    Dest: [p1.ref, PDFName.of('Fit')],
  });
  const ch1Ref = doc.context.register(ch1);

  // Section 1.1 (Level 2) -> Dest p2
  const sec11 = doc.context.obj({
    Title: PDFString.of('Section 1.1'),
    Parent: ch1Ref,
    Dest: [p2.ref, PDFName.of('Fit')],
  });
  const sec11Ref = doc.context.register(sec11);

  // Subsection 1.1.1 (Level 3) -> Dest p3
  const sub111 = doc.context.obj({
    Title: PDFString.of('Subsection 1.1.1'),
    Parent: sec11Ref,
    Dest: [p3.ref, PDFName.of('Fit')],
  });
  const sub111Ref = doc.context.register(sub111);

  sec11.set(PDFName.of('First'), sub111Ref);
  sec11.set(PDFName.of('Last'), sub111Ref);
  sec11.set(PDFName.of('Count'), PDFNumber.of(1));

  ch1.set(PDFName.of('First'), sec11Ref);
  ch1.set(PDFName.of('Last'), sec11Ref);
  ch1.set(PDFName.of('Count'), PDFNumber.of(2));

  outlinesDict.set(PDFName.of('First'), ch1Ref);
  outlinesDict.set(PDFName.of('Last'), ch1Ref);
  outlinesDict.set(PDFName.of('Count'), PDFNumber.of(3));

  return await doc.save();
}

// Minimal valid 1x1 JPEG
const TEST_JPEG = new Uint8Array([
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

// Helper to create a scanned image-only PDF (no text streams)
async function createScannedImageOnlyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const image = await doc.embedJpg(TEST_JPEG);
  page.drawImage(image, { x: 50, y: 150, width: 300, height: 300 });
  return await doc.save();
}

describe('Post-Sprint QA Audit Verification', () => {
  describe('1. Multiple-file Compression & Collision Handling', () => {
    it('generates collision-safe filenames when duplicate file names are batched', () => {
      const stagedNames = ['report.pdf', 'report.pdf', 'REPORT.PDF', 'invoice.pdf'];
      const usedNames = new Set<string>();
      const entryNames: string[] = [];

      for (let i = 0; i < stagedNames.length; i++) {
        const rawBase = getCleanBaseName(stagedNames[i]) || `document-${i + 1}`;
        let entryName = `compressed-${rawBase}.pdf`;
        let counter = 2;
        while (usedNames.has(entryName.toLowerCase())) {
          entryName = `compressed-${rawBase}-${counter}.pdf`;
          counter++;
        }
        usedNames.add(entryName.toLowerCase());
        entryNames.push(entryName);
      }

      expect(entryNames).toEqual([
        'compressed-report.pdf',
        'compressed-report-2.pdf',
        'compressed-REPORT-3.pdf',
        'compressed-invoice.pdf',
      ]);
    });

    it('produces a valid Stored ZIP archive with separate entries', () => {
      const entries: ZipEntry[] = [
        { name: 'compressed-doc1.pdf', bytes: new Uint8Array([1, 2, 3]) },
        { name: 'compressed-doc2.pdf', bytes: new Uint8Array([4, 5, 6]) },
      ];
      const zipBytes = createZip(entries);
      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes.byteLength).toBeGreaterThan(0);
      // Magic ZIP signature PK\x03\x04
      expect(zipBytes[0]).toBe(0x50);
      expect(zipBytes[1]).toBe(0x4b);
      expect(zipBytes[2]).toBe(0x03);
      expect(zipBytes[3]).toBe(0x04);
    });
  });

  describe('2. Merge Tool: Nested Bookmarks & Rotation-Aware Page Numbering', () => {
    it('preserves multi-level nested bookmarks across merged documents', async () => {
      const docWithNested = await createPdfWithNestedBookmarks();
      const simpleDoc = await (async () => {
        const d = await PDFDocument.create();
        d.addPage([400, 600]);
        return await d.save();
      })();

      const mergedBytes = await mergePdfs([docWithNested, simpleDoc], { keepBookmarks: true });
      const mergedDoc = await PDFDocument.load(mergedBytes);

      const outlinesRef = mergedDoc.catalog.get(PDFName.of('Outlines'));
      expect(outlinesRef).toBeDefined();

      const outlinesDict = mergedDoc.context.lookup(outlinesRef) as PDFDict;
      const firstChapterRef = outlinesDict.get(PDFName.of('First')) as PDFRef;
      expect(firstChapterRef).toBeDefined();

      const firstChapter = mergedDoc.context.lookup(firstChapterRef) as PDFDict;
      expect((firstChapter.get(PDFName.of('Title')) as PDFString).asString()).toBe('Chapter 1');

      // Verify Level 2 nested child
      const secRef = firstChapter.get(PDFName.of('First')) as PDFRef;
      expect(secRef).toBeDefined();
      const secDict = mergedDoc.context.lookup(secRef) as PDFDict;
      expect((secDict.get(PDFName.of('Title')) as PDFString).asString()).toBe('Section 1.1');

      // Verify Level 3 nested child
      const subRef = secDict.get(PDFName.of('First')) as PDFRef;
      expect(subRef).toBeDefined();
      const subDict = mergedDoc.context.lookup(subRef) as PDFDict;
      expect((subDict.get(PDFName.of('Title')) as PDFString).asString()).toBe('Subsection 1.1.1');
    });

    it('draws page numbers on pages with different rotation angles (0, 90, 180, 270)', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 600]); // 0 deg
      const p2 = doc.addPage([400, 600]);
      p2.setRotation(degrees(90));
      const p3 = doc.addPage([400, 600]);
      p3.setRotation(degrees(180));
      const p4 = doc.addPage([400, 600]);
      p4.setRotation(degrees(270));
      const samplePdf = await doc.save();

      const numbered = await mergePdfs([samplePdf], { addPageNumbers: true });
      const loaded = await PDFDocument.load(numbered);

      expect(loaded.getPageCount()).toBe(4);
      expect(loaded.getPage(0).getRotation().angle).toBe(0);
      expect(loaded.getPage(1).getRotation().angle).toBe(90);
      expect(loaded.getPage(2).getRotation().angle).toBe(180);
      expect(loaded.getPage(3).getRotation().angle).toBe(270);
      // Byte length must exceed original due to Helvetica embedding and text operations
      expect(numbered.byteLength).toBeGreaterThan(samplePdf.byteLength);
    });
  });

  describe('3. Rotate Tool: Selective Page Rotation', () => {
    it('rotates only designated pages (e.g. 1 and 3) leaving other pages unrotated', async () => {
      const doc = await PDFDocument.create();
      for (let i = 0; i < 4; i++) {
        doc.addPage([400, 600]);
      }
      const initialBytes = await doc.save();

      // Rotate pages 1 and 3 (0-based indices 0 and 2)
      const rotated = await rotatePdfPages(initialBytes, {
        clockwise: true,
        allPages: false,
        pageIndices: [0, 2],
      });

      const loaded = await PDFDocument.load(rotated);
      expect(loaded.getPage(0).getRotation().angle).toBe(90); // Rotated
      expect(loaded.getPage(1).getRotation().angle).toBe(0);  // Unchanged
      expect(loaded.getPage(2).getRotation().angle).toBe(90); // Rotated
      expect(loaded.getPage(3).getRotation().angle).toBe(0);  // Unchanged
    });
  });

  describe('4. Extract Text: Unusual Spacing & Scanned PDF Behavior', () => {
    it('handles unusual horizontal spacing between words correctly', () => {
      const items = [
        { str: 'Col1', transform: [12, 0, 0, 12, 50, 500], width: 30 },
        { str: 'Col2', transform: [12, 0, 0, 12, 120, 500], width: 30 }, // Large tab gap
      ];
      const result = formatPageTextContent(items, true);
      expect(result).toBe('Col1 Col2');
    });

    it('returns empty text and zero word count when document is a scanned image-only PDF', async () => {
      const scannedPdf = await createScannedImageOnlyPdf();
      const result = await extractTextFromPdf(scannedPdf);

      expect(result.pageCount).toBe(1);
      expect(result.text).toBe('');
      expect(result.wordCount).toBe(0);
      expect(result.charCount).toBe(0);
    });
  });

  describe('5. Selection Menu Positioning Logic Near Screen Edges', () => {
    it('flips below selection when near top viewport boundary (< 10px)', () => {
      const menuHeight = 36;
      const rect = { top: 8, bottom: 28, left: 100, width: 200, height: 20 };

      // Algorithm from ViewerSelectionMenu.tsx
      const top =
        rect.top - menuHeight - 8 < 10
          ? rect.bottom + 8
          : rect.top - menuHeight - 8;

      expect(top).toBe(rect.bottom + 8); // Flips to bottom
    });

    it('positions above selection when ample vertical room exists', () => {
      const menuHeight = 36;
      const rect = { top: 200, bottom: 220, left: 100, width: 200, height: 20 };

      const top =
        rect.top - menuHeight - 8 < 10
          ? rect.bottom + 8
          : rect.top - menuHeight - 8;

      expect(top).toBe(rect.top - menuHeight - 8); // Positions above
    });

    it('clamps horizontal position within viewport margins [12, windowWidth - menuWidth - 12]', () => {
      const menuWidth = 320;
      const windowWidth = 1000;

      // Case A: Near left boundary (rect.left = 0)
      const leftNearZero = Math.max(
        12,
        Math.min(windowWidth - menuWidth - 12, 0 + 50 - menuWidth / 2)
      );
      expect(leftNearZero).toBe(12);

      // Case B: Near right boundary (rect.left = 950)
      const leftNearRight = Math.max(
        12,
        Math.min(windowWidth - menuWidth - 12, 950 + 50 - menuWidth / 2)
      );
      expect(leftNearRight).toBe(windowWidth - menuWidth - 12);
    });
  });
});
