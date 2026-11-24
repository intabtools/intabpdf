import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');
const SCRATCH_DIR = '/home/ayusman/.gemini/antigravity-cli/brain/e576e3dd-8e30-4701-9d8c-2237462a03fe/scratch';

test.describe('Phase 3: PasswordInput Shared Component Verification', () => {
  test('ProtectTool: verifies PasswordInput rendering, strength meter, confirm matching, and mobile touch targets', async ({ page }) => {
    // Desktop Light
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tool/protect');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(samplePdf);

    const docPasswordInput = page.locator('input[placeholder="Enter password to open this PDF"]');
    const confirmPasswordInput = page.locator('input[placeholder="Re-enter password to confirm"]');

    await expect(docPasswordInput).toBeVisible();
    await expect(confirmPasswordInput).toBeVisible();

    // Type password and check strength meter
    await docPasswordInput.fill('TestSecret2026!');
    await expect(page.locator('text=Strength:')).toBeVisible();

    // Type mismatch confirm password
    await confirmPasswordInput.fill('Mismatch!');
    await expect(page.locator('text=Passwords do not match')).toBeVisible();

    // Capture screenshot of mismatch state in desktop light
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'protect-password-desktop-light.png') });

    // Switch to Mobile Dark
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

    // Fix confirm password
    await confirmPasswordInput.fill('TestSecret2026!');
    await expect(page.locator('text=Passwords do not match')).not.toBeVisible();

    // Check toggle button dimensions on mobile
    const toggleButtons = page.locator('.password-toggle-btn');
    const firstToggle = toggleButtons.first();
    const box = await firstToggle.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Toggle password visibility
    await firstToggle.click();
    await expect(docPasswordInput).toHaveAttribute('type', 'text');
    await expect(firstToggle).toHaveAttribute('aria-label', 'Hide password');

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'protect-password-mobile-dark.png') });
  });

  test('UnlockTool: verifies PasswordInput rendering, helper text, and 44px touch targets', async ({ page }) => {
    // Desktop Light
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tool/unlock');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(samplePdf);

    const passwordInput = page.locator('input[placeholder="Enter password to unlock document"]');
    await expect(passwordInput).toBeVisible();

    // Verify helper text
    await expect(page.locator('text=Enter either the user (open) password or owner (permissions) password.')).toBeVisible();

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'unlock-password-desktop-light.png') });

    // Mobile Dark
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

    const toggleBtn = page.locator('.password-toggle-btn').first();
    const box = await toggleBtn.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'unlock-password-mobile-dark.png') });
  });

  test('NoticeBanner: verifies responsive wrapping and contrast across light and dark viewports', async ({ page }) => {
    // 1. Desktop Light on Text to PDF with warning banner
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tool/text-to-pdf');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    const textarea = page.locator('textarea');
    await textarea.fill('Document with unsupported Chinese character: 漢字');

    const warningBanner = page.locator('.notice-banner.notice-banner-warning');
    await expect(warningBanner).toBeVisible();
    await expect(warningBanner).toContainText('Unsupported characters detected');
    await expect(warningBanner).toHaveAttribute('role', 'alert');

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'notice-banner-desktop-light.png') });

    // 2. Desktop Dark on Text to PDF
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'notice-banner-desktop-dark.png') });

    // 3. Mobile Light on Text to PDF
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const boxLight = await warningBanner.boundingBox();
    expect(boxLight).toBeTruthy();
    expect(boxLight!.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'notice-banner-mobile-light.png') });

    // 4. Mobile Dark on Text to PDF
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const boxDark = await warningBanner.boundingBox();
    expect(boxDark).toBeTruthy();
    expect(boxDark!.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'notice-banner-mobile-dark.png') });
  });
});
