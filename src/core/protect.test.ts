import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { isEncrypted, decryptPDF } from '@pdfsmaller/pdf-decrypt';
import { protectPdf } from './protect';

async function createSimplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  page.drawText('Protected Document Content');
  return await doc.save();
}

describe('protectPdf', () => {
  it('encrypts a valid PDF with AES-256 by default', async () => {
    const rawPdf = await createSimplePdf();
    const initialStatus = await isEncrypted(rawPdf);
    expect(initialStatus.encrypted).toBe(false);

    const protectedBytes = await protectPdf(rawPdf, {
      password: 'testPassword123',
    });

    expect(protectedBytes).toBeInstanceOf(Uint8Array);
    expect(protectedBytes.byteLength).toBeGreaterThan(0);

    const status = await isEncrypted(protectedBytes);
    expect(status.encrypted).toBe(true);
    expect(status.algorithm).toBe('AES-256');

    // Verify it can be decrypted with the right password
    const decrypted = await decryptPDF(protectedBytes, 'testPassword123');
    const doc = await PDFDocument.load(decrypted);
    expect(doc.getPageCount()).toBe(1);
  });

  it('supports RC4 encryption algorithm', async () => {
    const rawPdf = await createSimplePdf();
    const protectedBytes = await protectPdf(rawPdf, {
      password: 'legacyPassword456',
      algorithm: 'RC4',
    });

    const status = await isEncrypted(protectedBytes);
    expect(status.encrypted).toBe(true);
    expect(status.algorithm).toBe('RC4');

    const decrypted = await decryptPDF(protectedBytes, 'legacyPassword456');
    const doc = await PDFDocument.load(decrypted);
    expect(doc.getPageCount()).toBe(1);
  });

  it('applies permission restrictions correctly', async () => {
    const rawPdf = await createSimplePdf();
    const protectedBytes = await protectPdf(rawPdf, {
      password: 'permPassword',
      allowPrinting: false,
      allowCopying: false,
      allowModifying: false,
      allowAnnotating: false,
    });

    const status = await isEncrypted(protectedBytes);
    expect(status.encrypted).toBe(true);

    const decrypted = await decryptPDF(protectedBytes, 'permPassword');
    expect(decrypted.byteLength).toBeGreaterThan(0);
  });

  it('rejects an already encrypted PDF with a descriptive error', async () => {
    const rawPdf = await createSimplePdf();
    const protectedOnce = await protectPdf(rawPdf, { password: 'pass1' });

    await expect(protectPdf(protectedOnce, { password: 'pass2' })).rejects.toThrow(
      'This PDF is already password protected. Unlock it first before applying new protection.'
    );
  });

  it('rejects empty or whitespace-only password', async () => {
    const rawPdf = await createSimplePdf();
    await expect(protectPdf(rawPdf, { password: '' })).rejects.toThrow(
      'Password cannot be empty.'
    );
    await expect(protectPdf(rawPdf, { password: '   ' })).rejects.toThrow(
      'Password cannot be empty.'
    );
  });

  it('rejects password mismatch when confirmPassword is provided', async () => {
    const rawPdf = await createSimplePdf();
    await expect(
      protectPdf(rawPdf, { password: 'alpha', confirmPassword: 'beta' })
    ).rejects.toThrow('Passwords do not match.');
  });

  it('rejects empty or invalid PDF bytes', async () => {
    await expect(protectPdf(new Uint8Array(0), { password: 'pass' })).rejects.toThrow(
      'No PDF bytes provided to protect.'
    );

    const notAPdf = new Uint8Array([1, 2, 3, 4, 5, 6]);
    await expect(protectPdf(notAPdf, { password: 'pass' })).rejects.toThrow(
      'Invalid PDF: file does not start with %PDF- header.'
    );
  });

  it('aborts immediately when AbortSignal is already cancelled', async () => {
    const rawPdf = await createSimplePdf();
    const controller = new AbortController();
    controller.abort(new Error('User cancelled'));

    await expect(
      protectPdf(rawPdf, { password: 'pass' }, controller.signal)
    ).rejects.toThrow('User cancelled');
  });
});
