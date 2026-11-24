import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import { isEncrypted, decryptPDF } from '@pdfsmaller/pdf-decrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');

test.describe('Protect PDF End-to-End Workflow', () => {
  test('Workflow 1: Uploads PDF, enters password, protects and verifies encryption', async ({ page }) => {
    await page.goto('/tool/protect');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(samplePdf);

    // Verify password card is visible
    await expect(page.locator('text=Set Document Password')).toBeVisible({ timeout: 10000 });

    // Enter password and confirm password
    const passwordInput = page.locator('input[placeholder="Enter password to open this PDF"]');
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill('SecureDoc2026!');

    const confirmPasswordInput = page.locator('input[placeholder="Re-enter password to confirm"]');
    await expect(confirmPasswordInput).toBeVisible();
    await confirmPasswordInput.fill('SecureDoc2026!');

    // Protect PDF CTA button should become enabled
    const protectBtn = page.locator('button.cta:has-text("Protect PDF")');
    await expect(protectBtn).toBeEnabled();
    await protectBtn.click();

    // Wait for the Save PDF button
    const savePdfBtn = page.locator('button:has-text("Save PDF")');
    await expect(savePdfBtn).toBeVisible({ timeout: 15000 });

    // Download the protected PDF
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      savePdfBtn.click(),
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect(fs.existsSync(downloadPath!)).toBe(true);

    const fileBytes = fs.readFileSync(downloadPath!);
    expect(fileBytes.byteLength).toBeGreaterThan(100);

    // Verify %PDF header
    const header = fileBytes.subarray(0, 4).toString('utf-8');
    expect(header).toBe('%PDF');

    // Verify the document is actually encrypted
    const status = await isEncrypted(new Uint8Array(fileBytes));
    expect(status.encrypted).toBe(true);
    expect(status.algorithm).toBe('AES-256');

    // Verify decryption with correct password succeeds and preserves pages
    const decrypted = await decryptPDF(new Uint8Array(fileBytes), 'SecureDoc2026!');
    const doc = await PDFDocument.load(decrypted);
    expect(doc.getPageCount()).toBe(5);
  });
});
