import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');

test.describe('Reorder PDF End-to-End Workflow', () => {
  test('Workflow 1: Uploads 5-page PDF, reverses order, creates and downloads valid reordered PDF', async ({ page }) => {
    await page.goto('/tool/reorder');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(samplePdf);

    // Verify 5 page cards are displayed in the workspace
    await expect(page.locator('text=Page 1')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Page 5')).toBeVisible();

    // Click Reverse button to invert order
    const reverseBtn = page.locator('button:has-text("Reverse")');
    await expect(reverseBtn).toBeVisible();
    await reverseBtn.click();

    // Reorder CTA button should be enabled
    const reorderBtn = page.locator('button.cta:has-text("Reorder PDF")');
    await expect(reorderBtn).toBeEnabled();
    await reorderBtn.click();

    // Wait for the Save PDF button
    const savePdfBtn = page.locator('button:has-text("Save PDF")');
    await expect(savePdfBtn).toBeVisible({ timeout: 15000 });

    // Download the reordered PDF
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

    // Parse and verify page count is preserved
    const doc = await PDFDocument.load(fileBytes);
    expect(doc.getPageCount()).toBe(5);
  });
});
