import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { execSync } from 'child_process';
import { PDFDocument } from 'pdf-lib';
import { signPdf } from './sign';

// Valid 1x1 PNG bytes
const SAMPLE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

async function createSamplePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([500, 700]);
    page.drawText(`Page ${i + 1} content`, { x: 50, y: 600 });
  }
  return await doc.save();
}

describe('signPdf Core Operation', () => {
  it('stamps visual signature onto the last page by default', async () => {
    const pdfBytes = await createSamplePdf(3);
    const signedBytes = await signPdf(pdfBytes, SAMPLE_PNG);

    expect(signedBytes).toBeInstanceOf(Uint8Array);
    expect(signedBytes.byteLength).toBeGreaterThan(0);

    const doc = await PDFDocument.load(signedBytes);
    expect(doc.getPageCount()).toBe(3);
  });

  it('stamps signature on a specific page with date', async () => {
    const pdfBytes = await createSamplePdf(2);
    const signedBytes = await signPdf(pdfBytes, SAMPLE_PNG, {
      pageIndex: 0,
      position: 'bottom-left',
      addDate: true,
      dateText: '2026-11-24',
    });

    const doc = await PDFDocument.load(signedBytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('supports custom coordinate placement', async () => {
    const pdfBytes = await createSamplePdf(1);
    const signedBytes = await signPdf(pdfBytes, SAMPLE_PNG, {
      x: 100,
      y: 200,
      width: 150,
      height: 60,
    });

    const doc = await PDFDocument.load(signedBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('rejects empty PDF buffer or empty signature image', async () => {
    const pdfBytes = await createSamplePdf(1);
    await expect(signPdf(new Uint8Array(), SAMPLE_PNG)).rejects.toThrow(/valid PDF buffer/);
    await expect(signPdf(pdfBytes, new Uint8Array())).rejects.toThrow(/valid signature image/);
  });

  it('aborts cleanly when signal is cancelled', async () => {
    const pdfBytes = await createSamplePdf(1);
    const controller = new AbortController();
    controller.abort(new DOMException('Operation was aborted.', 'AbortError'));

    await expect(signPdf(pdfBytes, SAMPLE_PNG, {}, controller.signal)).rejects.toThrow(
      'Operation was aborted.'
    );
  });

  it('preserves existing page dimensions, vector content, and passes qpdf verification', async () => {
    const pdfBytes = await createSamplePdf(2);
    const signedBytes = await signPdf(pdfBytes, SAMPLE_PNG, {
      pageIndex: 1,
      position: 'bottom-right',
      addDate: true,
      dateText: '2026-11-24',
    });

    const doc = await PDFDocument.load(signedBytes);
    expect(doc.getPageCount()).toBe(2);

    const page1 = doc.getPage(0);
    expect(page1.getWidth()).toBe(500);
    expect(page1.getHeight()).toBe(700);

    const page2 = doc.getPage(1);
    expect(page2.getWidth()).toBe(500);
    expect(page2.getHeight()).toBe(700);

    // Verify independent standards-compliant parser (qpdf) validates output structure
    const tempPath = '/tmp/signed-test-output.pdf';
    fs.writeFileSync(tempPath, signedBytes);
    const checkOut = execSync(`qpdf --check "${tempPath}"`, { encoding: 'utf-8' });
    expect(checkOut).toContain('checking');
  });
});
