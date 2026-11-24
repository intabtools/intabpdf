import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');

test.describe('Sign PDF End-to-End Workflow', () => {
  test('Workflow 1: Uploads PDF, types a signature, signs and downloads valid PDF', async ({ page }) => {
    await page.goto('/tool/sign');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(samplePdf);

    // Verify signature creator is visible
    await expect(page.locator('text=Create Signature')).toBeVisible({ timeout: 10000 });

    // Switch to Type tab
    await page.locator('button:has-text("Type")').click();

    // Type a signature name
    const nameInput = page.locator('input[placeholder="Type your name..."]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Alex Rivera');

    // Sign PDF CTA button should become enabled
    const signBtn = page.locator('button.cta:has-text("Sign PDF")');
    await expect(signBtn).toBeEnabled();
    await signBtn.click();

    // Wait for the Save PDF button
    const savePdfBtn = page.locator('button:has-text("Save PDF")');
    await expect(savePdfBtn).toBeVisible({ timeout: 15000 });

    // Download the signed PDF
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

    // Parse and verify page count is preserved (sample.pdf has 5 pages)
    const doc = await PDFDocument.load(fileBytes);
    expect(doc.getPageCount()).toBe(5);
  });
});
