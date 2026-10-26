import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { imagesToPdf } from '../core/images-to-pdf';
import { calculateDropIndex, reorderItems } from './reorder';
import type { StagedFile } from './types';

// Minimal 1x1, 2x1, and 1x2 test PNGs
const PNG_2X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x36, 0x8a, 0xb6, 0xb6, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const PNG_1X2 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x5b, 0x38, 0x21, 0x98, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('Images to PDF - reordering, page numbering, and PDF output consistency', () => {
  const fileA: StagedFile = { id: 'a', name: 'photo-A-2x1.png', size: PNG_2X1.byteLength, bytes: PNG_2X1 };
  const fileB: StagedFile = { id: 'b', name: 'photo-B-1x1.png', size: PNG_1X1.byteLength, bytes: PNG_1X1 };
  const fileC: StagedFile = { id: 'c', name: 'photo-C-1x2.png', size: PNG_1X2.byteLength, bytes: PNG_1X2 };

  it('calculates live page numbers directly from array order', () => {
    let files = [fileA, fileB, fileC];

    // Initial page numbering
    expect(files.map((f, i) => ({ name: f.name, page: i + 1 }))).toEqual([
      { name: 'photo-A-2x1.png', page: 1 },
      { name: 'photo-B-1x1.png', page: 2 },
      { name: 'photo-C-1x2.png', page: 3 },
    ]);

    // Move item A (index 0) to end (index 2)
    files = reorderItems(files, 0, 2);
    expect(files.map((f, i) => ({ name: f.name, page: i + 1 }))).toEqual([
      { name: 'photo-B-1x1.png', page: 1 },
      { name: 'photo-C-1x2.png', page: 2 },
      { name: 'photo-A-2x1.png', page: 3 },
    ]);

    // Remove item C (currently at index 1)
    files = files.filter((f) => f.id !== 'c');
    expect(files.map((f, i) => ({ name: f.name, page: i + 1 }))).toEqual([
      { name: 'photo-B-1x1.png', page: 1 },
      { name: 'photo-A-2x1.png', page: 2 },
    ]);
  });

  it('guarantees generated PDF page sequence strictly matches UI reordered list', async () => {
    // Initial order: [A, B, C]
    const initialFiles = [fileA, fileB, fileC];

    // Reorder: move C from index 2 to index 0 using drag-and-drop calculation (before index 0)
    const dropTargetIndex = calculateDropIndex(2, 0, 'before');
    expect(dropTargetIndex).toBe(0);

    const reorderedFiles = reorderItems(initialFiles, 2, dropTargetIndex);
    expect(reorderedFiles.map((f) => f.id)).toEqual(['c', 'a', 'b']);

    // Generate PDF from reordered list
    const pdfBytes = await imagesToPdf(
      reorderedFiles.map((f) => ({ name: f.name, bytes: f.bytes })),
      { pageSizing: 'fit', margin: 'none' }
    );

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(3);

    // Page 1 should be C (1x2)
    expect(doc.getPage(0).getWidth()).toBe(1);
    expect(doc.getPage(0).getHeight()).toBe(2);

    // Page 2 should be A (2x1)
    expect(doc.getPage(1).getWidth()).toBe(2);
    expect(doc.getPage(1).getHeight()).toBe(1);

    // Page 3 should be B (1x1)
    expect(doc.getPage(2).getWidth()).toBe(1);
    expect(doc.getPage(2).getHeight()).toBe(1);
  });
});
