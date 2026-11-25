import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt';
import { isEncrypted } from '@pdfsmaller/pdf-decrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');

test.describe('Phase 3 & 8: Protect and Unlock Encryption Edge Cases', () => {
  test('UnlockTool & ProtectTool accurately report unsupported V=4 encryption instead of "not password protected"', async ({ page }) => {
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

    await page.goto('/tool/unlock');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'unsupported-v4.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(v4Bytes),
    });

    await expect(page.locator('text=Unsupported encryption variant')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=not password protected')).toHaveCount(0);
    await expect(page.locator('button.cta:has-text("Unlock PDF")')).toBeDisabled();

    await page.goto('/tool/protect');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'unsupported-v4.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(v4Bytes),
    });

    await expect(page.locator('text=Unsupported existing encryption')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button.cta:has-text("Protect PDF")')).toBeDisabled();
  });

  test('UnlockTool allows blank password submission for owner-only restricted PDFs and shows wrong-password errors', async ({ page }) => {
    const rawBytes = new Uint8Array(fs.readFileSync(samplePdf));
    const ownerOnlyBytes = await encryptPDF(rawBytes, '', {
      ownerPassword: 'OwnerOnlyPassword',
      allowCopying: false,
      allowPrinting: false,
    });

    await page.goto('/tool/unlock');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'owner-only.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(ownerOnlyBytes),
    });

    const unlockBtn = page.locator('button.cta:has-text("Unlock PDF")');
    await expect(unlockBtn).toBeEnabled({ timeout: 10000 });

    // First test wrong password triggers ToolPage status error
    const pwdInput = page.locator('input[type="password"], input[autocomplete="current-password"]').first();
    await pwdInput.fill('WrongPassword');
    await unlockBtn.click();
    await expect(page.locator('text=Incorrect password')).toBeVisible({ timeout: 10000 });

    // Clear password and unlock with blank user password
    await page.locator('button.cta:has-text("Try again")').click();
    await pwdInput.fill('');
    await expect(unlockBtn).toBeEnabled();
    await unlockBtn.click();

    const saveBtn = page.locator('button:has-text("Save PDF")');
    await expect(saveBtn).toBeVisible({ timeout: 15000 });
    const [download] = await Promise.all([page.waitForEvent('download'), saveBtn.click()]);
    const dlPath = await download.path();
    const outBytes = new Uint8Array(fs.readFileSync(dlPath!));
    expect((await isEncrypted(outBytes)).encrypted).toBe(false);
  });

  test('ProtectTool warns against non-ASCII passwords with RC4 and allows them with AES-256', async ({ page }) => {
    await page.goto('/tool/protect');
    await page.locator('input[type="file"]').first().setInputFiles(samplePdf);
    await expect(page.locator('text=Set Document Password')).toBeVisible({ timeout: 10000 });

    const pwdInput = page.locator('input[placeholder="Enter password to open this PDF"]');
    await pwdInput.fill('café');
    await page.getByRole('radio', { name: /RC4-128/i }).click();

    await expect(page.locator('text=RC4-128 supports ASCII passwords only')).toBeVisible();
    await expect(page.locator('button.cta:has-text("Protect PDF")')).toBeDisabled();

    await page.getByRole('radio', { name: /AES-256/i }).click();
    await expect(page.locator('button.cta:has-text("Protect PDF")')).toBeEnabled();

    // Removing staged file and choosing another file resets password, confirm password, algorithm, and local permission switches
    await page.getByRole('radio', { name: /RC4-128/i }).click();
    await page.locator('input[placeholder="Re-enter password to confirm"]').fill('café');
    await page.getByRole('switch', { name: 'Allow copying text' }).click();
    await page.locator('button[aria-label^="Remove "]').click();
    await page.locator('input[type="file"]').first().setInputFiles(samplePdf);
    await expect(page.locator('text=Set Document Password')).toBeVisible({ timeout: 10000 });
    await expect(pwdInput).toHaveValue('');
    await expect(page.locator('input[placeholder="Re-enter password to confirm"]')).toHaveValue('');
    await expect(page.getByRole('radio', { name: /AES-256/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Allow copying text' })).toHaveAttribute('aria-checked', 'true');
  });
});
