import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt';
import { isEncrypted } from '@pdfsmaller/pdf-decrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');

test.describe('Unlock PDF End-to-End Workflow', () => {
  test('Workflow 1: Uploads encrypted PDF, enters password, unlocks and saves unencrypted PDF', async ({ page }) => {
    // Prepare an encrypted sample PDF
    const rawBytes = fs.readFileSync(samplePdf);
    const encryptedBytes = await encryptPDF(new Uint8Array(rawBytes), 'OpenSesame2026!');
    const tempProtectedPath = path.resolve(__dirname, 'fixtures/temp-protected.pdf');
    fs.writeFileSync(tempProtectedPath, encryptedBytes);

    try {
      await page.goto('/tool/unlock');

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(tempProtectedPath);

      // Verify unlock card is visible
      await expect(page.locator('text=Enter Document Password')).toBeVisible({ timeout: 10000 });

      // Enter password
      const passwordInput = page.locator('input[placeholder="Enter password to unlock document"]');
      await expect(passwordInput).toBeVisible();
      await passwordInput.fill('OpenSesame2026!');

      // Unlock PDF CTA button should become enabled
      const unlockBtn = page.locator('button.cta:has-text("Unlock PDF")');
      await expect(unlockBtn).toBeEnabled();
      await unlockBtn.click();

      // Wait for the Save PDF button
      const savePdfBtn = page.locator('button:has-text("Save PDF")');
      await expect(savePdfBtn).toBeVisible({ timeout: 15000 });

      // Download the unlocked PDF
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        savePdfBtn.click(),
      ]);

      const downloadPath = await download.path();
      expect(downloadPath).toBeTruthy();
      expect(fs.existsSync(downloadPath!)).toBe(true);

      const fileBytes = fs.readFileSync(downloadPath!);
      expect(fileBytes.byteLength).toBeGreaterThan(100);

      // Verify header is %PDF
      const header = fileBytes.subarray(0, 4).toString('utf-8');
      expect(header).toBe('%PDF');

      // Verify document is now unencrypted
      const status = await isEncrypted(new Uint8Array(fileBytes));
      expect(status.encrypted).toBe(false);

      // Verify it can be loaded with standard pdf-lib without credentials
      const doc = await PDFDocument.load(fileBytes);
      expect(doc.getPageCount()).toBe(5);
    } finally {
      if (fs.existsSync(tempProtectedPath)) {
        fs.unlinkSync(tempProtectedPath);
      }
    }
  });
});
