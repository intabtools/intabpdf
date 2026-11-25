import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import { isEncrypted, decryptPDF } from '@pdfsmaller/pdf-decrypt';
import '../viewer/pdfjs-polyfills';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inspectPdfEncryption } from './pdfEncryptionStatus';
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

  it('clears both COPY and COPY_FOR_ACCESSIBILITY in PDF permissions when allowCopying is false (AES-256 & RC4)', async () => {
    const rawPdf = await createSimplePdf();
    const { PermissionFlag } = pdfjsLib;

    for (const algorithm of ['AES-256', 'RC4'] as const) {
      const restricted = await protectPdf(rawPdf, {
        password: 'user-pass-1',
        algorithm,
        allowPrinting: true,
        allowCopying: false,
      });
      const restrictedTask = pdfjsLib.getDocument({
        data: new Uint8Array(restricted),
        password: 'user-pass-1',
      });
      const restrictedDoc = await restrictedTask.promise;
      const restrictedPerms = await restrictedDoc.getPermissions();
      expect(restrictedPerms).not.toBeNull();
      expect(restrictedPerms).not.toContain(PermissionFlag.COPY);
      expect(restrictedPerms).not.toContain(PermissionFlag.COPY_FOR_ACCESSIBILITY);
      expect(restrictedPerms).toContain(PermissionFlag.PRINT);
      await restrictedTask.destroy();

      const allowed = await protectPdf(rawPdf, {
        password: 'user-pass-1',
        algorithm,
        allowPrinting: true,
        allowCopying: true,
      });
      const allowedTask = pdfjsLib.getDocument({
        data: new Uint8Array(allowed),
        password: 'user-pass-1',
      });
      const allowedDoc = await allowedTask.promise;
      const allowedPerms = await allowedDoc.getPermissions();
      expect(allowedPerms).not.toBeNull();
      expect(allowedPerms).toContain(PermissionFlag.COPY);
      expect(allowedPerms).toContain(PermissionFlag.COPY_FOR_ACCESSIBILITY);
      await allowedTask.destroy();
    }
  });

  it('rejects non-ASCII passwords for RC4 while supporting full Unicode for AES-256', async () => {
    const rawPdf = await createSimplePdf();

    await expect(
      protectPdf(rawPdf, { password: 'café', algorithm: 'RC4' }),
    ).rejects.toThrow(/RC4-128 only supports standard ASCII/i);

    const aesUnicode = await protectPdf(rawPdf, {
      password: 'café',
      algorithm: 'AES-256',
    });
    const decrypted = await decryptPDF(aesUnicode, 'café');
    expect(decrypted.byteLength).toBeGreaterThan(0);
  });

  it('distinguishes unsupported V=4 encryption and corrupt files without reporting unencrypted', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const encryptDict = doc.context.obj({
      Filter: PDFName.of('Standard'),
      V: PDFNumber.of(4),
      R: PDFNumber.of(4),
      Length: PDFNumber.of(128),
      P: PDFNumber.of(-60),
      O: PDFHexString.of('00'.repeat(32)),
      U: PDFHexString.of('00'.repeat(32)),
    }) as PDFDict;
    doc.context.trailerInfo.Encrypt = doc.context.register(encryptDict);
    const v4Bytes = await doc.save({ useObjectStreams: false });

    const inspection = await inspectPdfEncryption(v4Bytes);
    expect(inspection.status).toBe('unsupported');
    if (inspection.status === 'unsupported') {
      expect(inspection.version).toBe(4);
    }

    await expect(protectPdf(v4Bytes, { password: 'test' })).rejects.toThrow(/unsupported encryption/i);

    const corruptInspection = await inspectPdfEncryption(new Uint8Array([1, 2, 3, 4, 5]));
    expect(corruptInspection.status).toBe('corrupt');
  });
});
