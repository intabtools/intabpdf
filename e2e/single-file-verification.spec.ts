import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');
const samplePng = path.resolve(__dirname, 'fixtures/sample.png');

const SINGLE_FILE_TOOLS = ['protect', 'unlock', 'sign', 'reorder', 'remove-pages', 'split'];
const MULTI_FILE_TOOLS = ['merge', 'compress', 'rotate', 'pdf-to-images', 'extract-text', 'images-to-pdf'];

test.describe('Section 3: Exhaustive Single-File and Multi-File Handling Verification', () => {
  for (const toolId of SINGLE_FILE_TOOLS) {
    test(`Single-file tool "${toolId}": Drop multiple files rejects with clear toast`, async ({ page }) => {
      await page.goto(`/tool/${toolId}`);
      await page.waitForLoadState('networkidle');

      // 1. Initial file picker should not have multiple
      const fileInput = page.locator('input[type="file"]').first();
      expect(await fileInput.getAttribute('multiple')).toBeNull();

      // 2. Simulate selecting multiple files via input.files
      await page.evaluate(() => {
        const input = document.querySelector('input[type="file"]');
        const dt = new DataTransfer();
        dt.items.add(new File(['f1'], 'sample1.pdf', { type: 'application/pdf' }));
        dt.items.add(new File(['f2'], 'sample2.pdf', { type: 'application/pdf' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // 3. Clear message toast must appear
      const toast = page.locator('.intab-toast');
      await expect(toast).toBeVisible({ timeout: 5000 });
      await expect(toast).toContainText(/accepts only one PDF at a time/i);

      // 4. No files staged
      const stagedItems = page.locator('.card.fi');
      await expect(stagedItems).toHaveCount(0);
    });

    test(`Single-file tool "${toolId}": Stages exactly 1 file and hides Add more files`, async ({ page }) => {
      await page.goto(`/tool/${toolId}`);
      await page.waitForLoadState('networkidle');

      const fileInput = page.locator('input[type="file"]').first();

      // 1. Stage a valid single file
      await fileInput.setInputFiles(samplePdf);

      // Verify staged item exists
      const stagedItems = page.locator('.card.fi');
      await expect(stagedItems).toHaveCount(1, { timeout: 7000 });
      await expect(stagedItems.first()).toContainText('sample.pdf');

      // Verify "Add more files" prompt is NOT rendered for single-file tools
      await expect(page.locator('text=Add more files')).toHaveCount(0);
    });
  }

  for (const toolId of MULTI_FILE_TOOLS) {
    test(`Multi-file tool "${toolId}": accepts multiple files and shows Add more files`, async ({ page }) => {
      await page.goto(`/tool/${toolId}`);
      await page.waitForLoadState('networkidle');

      const fileInput = page.locator('input[type="file"]').first();
      expect(await fileInput.getAttribute('multiple')).not.toBeNull();

      if (toolId === 'images-to-pdf') {
        await fileInput.setInputFiles([samplePng, samplePng]);
      } else {
        await fileInput.setInputFiles([samplePdf, samplePdf]);
      }

      // Verify staged items
      const stagedItems = page.locator('.card.fi');
      await expect(stagedItems).toHaveCount(2, { timeout: 7000 });

      // Verify "Add more files" prompt is available
      const addMore = page.locator('text=Add more files');
      await expect(addMore).toBeVisible();
    });
  }
});
