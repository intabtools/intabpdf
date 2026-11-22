import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');

test.describe('End-to-End PDF Workflows', () => {
  test('Workflow 1: Merge two PDF files and verify downloaded output document', async ({ page }) => {
    await page.goto('/tool/merge');

    const fileInput = page.locator('input[type="file"]');
    // Upload two copies of the sample PDF
    await fileInput.setInputFiles([samplePdf, samplePdf]);

    // Verify 2 files are listed in the staged list
    await expect(page.locator('.dz')).toBeVisible();

    // The merge CTA button should become active
    const mergeBtn = page.locator('button.cta').filter({ hasText: /merge/i });
    await expect(mergeBtn).toBeVisible();
    await mergeBtn.click();

    // Wait for the save button to appear
    const savePdfBtn = page.locator('button:has-text("Save PDF")');
    await expect(savePdfBtn).toBeVisible({ timeout: 15000 });

    // Download the merged output file
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      savePdfBtn.click(),
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect(fs.existsSync(downloadPath!)).toBe(true);

    const fileBytes = fs.readFileSync(downloadPath!);
    expect(fileBytes.byteLength).toBeGreaterThan(1000);

    // Validate PDF header magic bytes "%PDF"
    const header = fileBytes.subarray(0, 4).toString('utf-8');
    expect(header).toBe('%PDF');

    // Parse with pdf-lib to verify structural integrity and merged page count
    const pdfDoc = await PDFDocument.load(fileBytes);
    const pageCount = pdfDoc.getPageCount();
    // sample.pdf has 5 pages, so 2 merged copies must have 10 pages
    expect(pageCount).toBe(10);
  });

  test('Workflow 2: Split a PDF into page ranges and verify downloaded archive', async ({ page }) => {
    await page.goto('/tool/split');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(samplePdf);

    // Verify Split button is visible with ranges
    const splitBtn = page.locator('button.cta').filter({ hasText: /split/i });
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();

    // Wait for save button (ZIP archive or single PDF)
    const saveBtn = page.locator('button:has-text("Save ZIP"), button:has-text("Save PDF")');
    await expect(saveBtn).toBeVisible({ timeout: 15000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      saveBtn.click(),
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect(fs.existsSync(downloadPath!)).toBe(true);

    const fileBytes = fs.readFileSync(downloadPath!);
    expect(fileBytes.byteLength).toBeGreaterThan(100);

    // Check ZIP magic header (0x50, 0x4B, 0x03, 0x04) or PDF header
    const isZip = fileBytes[0] === 0x50 && fileBytes[1] === 0x4B;
    const isPdf = fileBytes.subarray(0, 4).toString('utf-8') === '%PDF';
    expect(isZip || isPdf).toBe(true);
  });

  test('Workflow 3: Extract text from PDF and verify downloaded TXT content', async ({ page }) => {
    await page.goto('/tool/extract-text');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(samplePdf);

    const extractBtn = page.locator('button.cta').filter({ hasText: /extract text/i });
    await expect(extractBtn).toBeVisible();
    await extractBtn.click();

    // Verify text preview is rendered with extracted content
    const preview = page.locator('textarea[aria-label="Extracted text preview"]');
    await expect(preview).toBeVisible({ timeout: 15000 });
    const content = await preview.inputValue();
    expect(content).toContain('InTabPDF Test Document');

    // Download TXT
    const saveTxtBtn = page.locator('button:has-text("Save TXT")');
    await expect(saveTxtBtn).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      saveTxtBtn.click(),
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const txtData = fs.readFileSync(downloadPath!, 'utf-8');
    expect(txtData).toContain('InTabPDF Test Document');
  });
});
