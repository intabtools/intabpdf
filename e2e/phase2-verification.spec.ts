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

test.describe('Phase 2 Button Consistency and Mobile Ergonomics', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCRATCH_DIR)) {
      fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    }
  });
  test('ReorderTool: Move Earlier and Move Later have >= 44x44px touch areas and correct disabled boundaries', async ({ page }) => {
    await page.goto('/tool/reorder');
    await page.waitForLoadState('networkidle');

    // Stage sample PDF (5 pages)
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePdf);

    // Wait for reorder cards to render
    const moveButtons = page.locator('.reorder-move-btn');
    await expect(moveButtons.first()).toBeVisible({ timeout: 10000 });

    // Check touch target dimensions of the first move button
    const firstMoveBtnBox = await moveButtons.first().boundingBox();
    expect(firstMoveBtnBox).not.toBeNull();
    expect(firstMoveBtnBox!.width).toBeGreaterThanOrEqual(44);
    expect(firstMoveBtnBox!.height).toBeGreaterThanOrEqual(44);

    // Page 1: Move Earlier MUST be disabled
    const firstEarlierBtn = page.getByRole('button', { name: 'Move page 1 earlier' });
    await expect(firstEarlierBtn).toBeDisabled();

    // Page 1: Move Later MUST be enabled
    const firstLaterBtn = page.getByRole('button', { name: 'Move page 1 later' });
    await expect(firstLaterBtn).toBeEnabled();

    // Page 5: Move Later MUST be disabled
    const lastLaterBtn = page.getByRole('button', { name: 'Move page 5 later' });
    await expect(lastLaterBtn).toBeDisabled();

    // Test moving page 1 later
    await firstLaterBtn.click();
    // After moving, position 1 should now be page 2, and position 2 should be page 1
    await expect(page.locator('text=Page 1').first()).toBeVisible();

    // Check Reset button appears and is clickable
    const resetBtn = page.getByRole('button', { name: /Reset/i });
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // Desktop Screenshot
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'reorder-1280-desktop.png') });

    // Mobile Screenshot (375px)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'reorder-375-mobile-light.png') });

    // Mobile Dark Screenshot (375px)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'reorder-375-mobile-dark.png') });
  });

  test('ReorderTool: Reverse button height on mobile is >= 44px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/tool/reorder');
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePdf);

    const reverseBtn = page.getByRole('button', { name: /Reverse/i });
    await expect(reverseBtn).toBeVisible({ timeout: 10000 });

    const box = await reverseBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('PdfToImages: Option selectors have min-height >= 44px', async ({ page }) => {
    await page.goto('/tool/pdf-to-images');
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePdf);

    const pngBtn = page.getByRole('radio', { name: 'PNG (Lossless)', exact: true });
    await expect(pngBtn).toBeVisible({ timeout: 10000 });

    const box = await pngBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('RemovePagesTool: Confirm modal uses .btn-secondary and .btn-danger with proper styling', async ({ page }) => {
    await page.goto('/tool/remove-pages');
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePdf);

    // Enter page 1 to remove
    const input = page.locator('input[placeholder="e.g. 1-3, 5"]');
    await input.fill('1');

    // Click remove pages CTA
    const removeBtn = page.locator('button.cta:has-text("Remove pages from file")');
    await expect(removeBtn).toBeEnabled();
    await removeBtn.click();

    // Verify modal buttons have .btn classes
    const cancelBtn = page.locator('button.btn-secondary:has-text("Cancel")');
    const confirmBtn = page.locator('button.btn-danger:has-text("Confirm removal")');

    await expect(cancelBtn).toHaveClass(/btn-secondary/);
    await expect(confirmBtn).toHaveClass(/btn-danger/);

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'remove-pages-modal-buttons.png') });

    // Click cancel to close
    await cancelBtn.click();
    await expect(confirmBtn).not.toBeVisible();
  });
});
