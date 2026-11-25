import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { isEncrypted } from '@pdfsmaller/pdf-decrypt';
import { protectPdf } from './protect';
import { unlockPdf } from './unlock';

async function createSimplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  page.drawText('Confidential Unlocked Document Content');
  return await doc.save();
}

describe('unlockPdf', () => {
  it('unlocks an AES-256 protected PDF with the correct password', async () => {
    const rawPdf = await createSimplePdf();
    const protectedBytes = await protectPdf(rawPdf, {
      password: 'UnlockSecret2026',
      algorithm: 'AES-256',
    });

    const statusBefore = await isEncrypted(protectedBytes);
    expect(statusBefore.encrypted).toBe(true);

    const unlockedBytes = await unlockPdf(protectedBytes, {
      password: 'UnlockSecret2026',
    });

    expect(unlockedBytes).toBeInstanceOf(Uint8Array);
    expect(unlockedBytes.byteLength).toBeGreaterThan(0);

    const statusAfter = await isEncrypted(unlockedBytes);
    expect(statusAfter.encrypted).toBe(false);

    // Verify it loads in standard pdf-lib without any password or encryption bypass
    const doc = await PDFDocument.load(unlockedBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('unlocks an RC4 protected PDF with the correct password', async () => {
    const rawPdf = await createSimplePdf();
    const protectedBytes = await protectPdf(rawPdf, {
      password: 'Rc4Secret123',
      algorithm: 'RC4',
    });

    const statusBefore = await isEncrypted(protectedBytes);
    expect(statusBefore.encrypted).toBe(true);

    const unlockedBytes = await unlockPdf(protectedBytes, {
      password: 'Rc4Secret123',
    });

    const statusAfter = await isEncrypted(unlockedBytes);
    expect(statusAfter.encrypted).toBe(false);

    const doc = await PDFDocument.load(unlockedBytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('rejects incorrect password with an informative error', async () => {
    const rawPdf = await createSimplePdf();
    const protectedBytes = await protectPdf(rawPdf, {
      password: 'CorrectPassword',
    });

    await expect(
      unlockPdf(protectedBytes, { password: 'WrongPassword' })
    ).rejects.toThrow('Incorrect password. Please verify the password and try again.');
  });

  it('rejects an already unencrypted PDF with an informative error', async () => {
    const rawPdf = await createSimplePdf();
    await expect(
      unlockPdf(rawPdf, { password: 'anyPassword' })
    ).rejects.toThrow('This PDF is not password protected.');
  });

  it('rejects empty or invalid PDF bytes', async () => {
    await expect(unlockPdf(new Uint8Array(0), { password: 'pass' })).rejects.toThrow(
      'No PDF bytes provided to unlock.'
    );

    const notAPdf = new Uint8Array([1, 2, 3, 4, 5, 6]);
    await expect(unlockPdf(notAPdf, { password: 'pass' })).rejects.toThrow(
      'Invalid PDF: file does not start with %PDF- header.'
    );
  });

  it('aborts immediately when AbortSignal is already cancelled', async () => {
    const rawPdf = await createSimplePdf();
    const protectedBytes = await protectPdf(rawPdf, { password: 'pass' });

    const controller = new AbortController();
    controller.abort(new Error('User cancelled unlock'));

    await expect(
      unlockPdf(protectedBytes, { password: 'pass' }, controller.signal)
    ).rejects.toThrow('User cancelled unlock');
  });
});
