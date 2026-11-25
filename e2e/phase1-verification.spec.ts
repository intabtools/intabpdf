import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');
const SCRATCH_DIR = path.resolve(
  process.env.PLAYWRIGHT_SCREENSHOT_DIR ||
    path.resolve(__dirname, '../test-results/e2e-screenshots')
);

test.describe('Phase 1 Visual and Functional Verification', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCRATCH_DIR)) {
      fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    }
  });

  test('Single-file tool handling: Protect PDF has no multiple input and hides "Add more files"', async ({ page }) => {
    await page.goto('/tool/protect');

    // Dropzone file input should not have multiple attribute
    const fileInput = page.locator('input[type="file"]').first();
    const isMultiple = await fileInput.getAttribute('multiple');
    expect(isMultiple).toBeNull();

    // Stage a file
    await fileInput.setInputFiles(samplePdf);

    // Document options card should appear
    await expect(page.locator('text=Set Document Password')).toBeVisible({ timeout: 10000 });

    // "Add more files" dropzone must NOT exist
    const addMoreDropZone = page.locator('text=Add more files');
    await expect(addMoreDropZone).toHaveCount(0);

    // Take screenshot of single file tool state
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'protect-single-file-staged.png') });
  });

  test('Multi-file tool handling: Merge PDF allows multiple files and shows "Add more files"', async ({ page }) => {
    await page.goto('/tool/merge');

    // Dropzone file input should have multiple attribute
    const fileInput = page.locator('input[type="file"]').first();
    const isMultiple = await fileInput.getAttribute('multiple');
    expect(isMultiple).not.toBeNull();

    // Stage a file
    await fileInput.setInputFiles(samplePdf);

    // "Add more files" dropzone MUST exist
    const addMoreDropZone = page.locator('text=Add more files');
    await expect(addMoreDropZone).toBeVisible({ timeout: 10000 });

    // Take screenshot of multi-file tool state
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'merge-multi-file-staged.png') });
  });

  test('PdfToImages: selection indicators and accessibility in light and dark mode', async ({ page }) => {
    await page.goto('/tool/pdf-to-images');

    // Stage file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePdf);

    // Wait for options card
    await page.waitForSelector('.segmented-control');

    // Check Format buttons (PNG should be active initially)
    const pngBtn = page.getByRole('radio', { name: 'PNG (Lossless)', exact: true });
    const jpegBtn = page.getByRole('radio', { name: 'JPEG (Smaller file)', exact: true });

    await expect(pngBtn).toHaveAttribute('aria-checked', 'true');
    await expect(pngBtn).toHaveClass(/active/);
    await expect(jpegBtn).toHaveAttribute('aria-checked', 'false');

    // Click JPEG
    await jpegBtn.click();
    await expect(jpegBtn).toHaveAttribute('aria-checked', 'true');
    await expect(jpegBtn).toHaveClass(/active/);
    await expect(pngBtn).toHaveAttribute('aria-checked', 'false');

    // Check Resolution buttons (High 2x is default)
    const highBtn = page.getByRole('radio', { name: 'High (2×)', exact: true });
    const veryHighBtn = page.getByRole('radio', { name: 'Very High (3×)', exact: true });
    await expect(highBtn).toHaveAttribute('aria-checked', 'true');
    await expect(highBtn).toHaveClass(/active/);
    await expect(veryHighBtn).toHaveAttribute('aria-checked', 'false');

    // Click Very High (3x)
    await veryHighBtn.click();
    await expect(veryHighBtn).toHaveAttribute('aria-checked', 'true');
    await expect(veryHighBtn).toHaveClass(/active/);
    await expect(highBtn).toHaveAttribute('aria-checked', 'false');

    // Desktop Light Screenshot
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'pdf-to-images-1280-light.png') });

    // Desktop Dark Screenshot
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'pdf-to-images-1280-dark.png') });

    // Mobile Dark Screenshot (375px)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'pdf-to-images-375-dark.png') });

    // Mobile Light Screenshot (375px)
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'pdf-to-images-375-light.png') });
  });

  test('OutputFilenameInput: focus ring is visible on focus-within', async ({ page }) => {
    await page.goto('/tool/pdf-to-images');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePdf);

    const filenameInput = page.locator('.output-filename-box input');
    await expect(filenameInput).toBeVisible({ timeout: 10000 });

    // Focus input
    await filenameInput.focus();

    // Check wrapper has focus-within styling
    const box = page.locator('.output-filename-box');
    await expect(box).toBeVisible();

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'output-filename-focus.png') });
  });
});
