import { test, expect } from '@playwright/test';
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';

test.describe('Text to PDF End-to-End Workflow', () => {
  test('Workflow 1: Types text into editor, customizes options, creates and downloads valid PDF', async ({ page }) => {
    await page.goto('/tool/text-to-pdf');

    // Verify Text Content editor is visible immediately without requiring staged files
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();

    // Verify initial character count indicator
    await expect(page.locator('text=/0 \\/ 200,000 characters/')).toBeVisible();

    // Create PDF button should be disabled initially
    const createBtn = page.locator('button.cta:has-text("Create PDF")');
    await expect(createBtn).toBeDisabled();

    // Type text into the editor
    const sampleText = 'Welcome to InTabPDF!\n\nThis is a sample document generated from plain text.\nIt supports multiple pages, custom fonts, margins, and page numbering.';
    await textarea.fill(sampleText);

    // Verify counter updated
    await expect(page.locator(`text=/${sampleText.length} \\/ 200,000 characters/`)).toBeVisible();

    // Button should now be enabled
    await expect(createBtn).toBeEnabled();

    // Select Letter page size and Landscape orientation
    await page.locator('button:has-text("LETTER")').click();
    await page.locator('button:has-text("landscape")').click();

    // Click Create PDF
    await createBtn.click();

    // Wait for the result card and Save PDF button
    const savePdfBtn = page.locator('button:has-text("Save PDF")');
    await expect(savePdfBtn).toBeVisible({ timeout: 15000 });

    // Download the generated PDF
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

    // Parse and verify geometry
    const doc = await PDFDocument.load(fileBytes);
    expect(doc.getPageCount()).toBe(1);
    const pdfPage = doc.getPage(0);
    // Letter in landscape: width 792, height 612
    expect(pdfPage.getWidth()).toBeCloseTo(792, 1);
    expect(pdfPage.getHeight()).toBeCloseTo(612, 1);
  });

  test('Workflow 2: Displays warning and blocks generation when unsupported characters are entered', async ({ page }) => {
    await page.goto('/tool/text-to-pdf');

    const textarea = page.locator('textarea');
    await textarea.fill('Document with unsupported Chinese character: 漢字');

    // Warning banner should appear
    await expect(page.locator('text=Unsupported characters detected')).toBeVisible();

    // Create PDF button must be disabled
    const createBtn = page.locator('button.cta');
    await expect(createBtn).toBeDisabled();

    // Fix the text
    await textarea.fill('Document with supported characters only: ASCII and accents é, ü, €');

    // Warning banner disappears and button is enabled
    await expect(page.locator('text=Unsupported characters detected')).not.toBeVisible();
    await expect(createBtn).toBeEnabled();
  });
});
