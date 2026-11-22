import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const invalidFile = path.resolve(__dirname, 'fixtures/invalid.txt');
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');

test.describe('Invalid Input and Defensive Handling', () => {
  test('displays clear error alert and disables action button when corrupted/non-PDF file is staged', async ({ page }) => {
    await page.goto('/tool/split');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(invalidFile);

    // Verify error alert appears
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 5000 });
    await expect(alert).toContainText(/failed to/i);

    // Verify the split action button is either disabled or absent
    const splitBtn = page.locator('button.cta').filter({ hasText: /split/i });
    if ((await splitBtn.count()) > 0) {
      await expect(splitBtn).toBeDisabled();
    }
  });

  test('validates out-of-bounds page range input and prevents invalid split execution', async ({ page }) => {
    await page.goto('/tool/split');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(samplePdf);

    // Wait for range input to appear with default valid range
    const rangeInput = page.locator('input[placeholder="e.g. 1-2, 3-5"]');
    await expect(rangeInput).toBeVisible({ timeout: 5000 });

    // Enter an invalid out-of-bounds range (sample.pdf has 5 pages)
    await rangeInput.fill('99-100');

    // Live validation error should appear
    const rangeError = page.locator('text=exceeds total pages, text=Invalid range, text=out of bounds').first();
    await expect(rangeError.or(page.locator('text=exceeds'))).toBeVisible({ timeout: 5000 });

    // Split button must be disabled
    const splitBtn = page.locator('button.cta').filter({ hasText: /split/i });
    await expect(splitBtn).toBeDisabled();
  });
});
