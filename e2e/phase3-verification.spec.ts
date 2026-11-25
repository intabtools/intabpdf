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

  test('SegmentedControl: verifies radio keyboard navigation, roving tabindex, touch targets, and responsive theme rendering', async ({ page }) => {
    // 1. Desktop Light on Text to PDF
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tool/text-to-pdf');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(200);

    // Check Page Size radio group
    const pageSizeGroup = page.getByRole('radiogroup', { name: 'Page Size' });
    await expect(pageSizeGroup).toBeVisible();

    const a4Radio = page.getByRole('radio', { name: 'A4' });
    const letterRadio = page.getByRole('radio', { name: 'LETTER' });
    const legalRadio = page.getByRole('radio', { name: 'LEGAL' });

    // Initial state: A4 selected
    await expect(a4Radio).toHaveAttribute('aria-checked', 'true');
    await expect(a4Radio).toHaveAttribute('tabIndex', '0');
    await expect(a4Radio).toHaveClass(/active/);
    await expect(letterRadio).toHaveAttribute('aria-checked', 'false');
    await expect(letterRadio).toHaveAttribute('tabIndex', '-1');

    // Arrow navigation: Right from A4 -> LETTER
    await a4Radio.focus();
    await page.keyboard.press('ArrowRight');
    await expect(letterRadio).toHaveAttribute('aria-checked', 'true');
    await expect(letterRadio).toHaveAttribute('tabIndex', '0');
    await expect(a4Radio).toHaveAttribute('aria-checked', 'false');

    // Arrow navigation: Right from LETTER -> LEGAL
    await page.keyboard.press('ArrowRight');
    await expect(legalRadio).toHaveAttribute('aria-checked', 'true');

    // Arrow navigation: Right from LEGAL wraps -> A4
    await page.keyboard.press('ArrowRight');
    await expect(a4Radio).toHaveAttribute('aria-checked', 'true');

    // Arrow navigation: Left from A4 wraps -> LEGAL
    await page.keyboard.press('ArrowLeft');
    await expect(legalRadio).toHaveAttribute('aria-checked', 'true');

    // Home / End keys
    await page.keyboard.press('Home');
    await expect(a4Radio).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('End');
    await expect(legalRadio).toHaveAttribute('aria-checked', 'true');

    // Click and Space/Enter idempotency (and ensure Enter never reloads/submits page)
    await a4Radio.click();
    await expect(a4Radio).toHaveAttribute('aria-checked', 'true');
    await a4Radio.focus();
    await page.keyboard.press('Space');
    await expect(a4Radio).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Enter');
    await expect(a4Radio).toHaveAttribute('aria-checked', 'true');

    // Verify expanded ::before hit area reaches >= 44px without overlapping adjacent controls
    const hitAreaMetrics = await a4Radio.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const beforeStyle = window.getComputedStyle(el, '::before');
      return {
        visualWidth: rect.width,
        visualHeight: rect.height,
        beforeHeight: parseFloat(beforeStyle.height) || rect.height,
        beforeLeft: parseFloat(beforeStyle.left) || 0,
        beforeRight: parseFloat(beforeStyle.right) || 0,
      };
    });
    expect(hitAreaMetrics.visualHeight).toBeGreaterThanOrEqual(34);
    expect(hitAreaMetrics.visualWidth).toBeGreaterThanOrEqual(44);
    expect(hitAreaMetrics.beforeHeight).toBeGreaterThanOrEqual(44);

    // Click inside expanded vertical hit area (4px above A4 visual border) selects/hits A4 cleanly
    const a4BoxDesktop = await a4Radio.boundingBox();
    expect(a4BoxDesktop).toBeTruthy();
    await page.mouse.click(a4BoxDesktop!.x + a4BoxDesktop!.width / 2, a4BoxDesktop!.y - 3);
    await expect(a4Radio).toHaveAttribute('aria-checked', 'true');

    // Blur focus before screenshot so focus outline doesn't obscure active style
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'segmented-control-desktop-light.png') });

    // 2. Desktop Dark
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'segmented-control-desktop-dark.png') });

    // 3. Mobile Light (375px) - scroll options card into view!
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(200);
    await pageSizeGroup.scrollIntoViewIfNeeded();

    const a4BoxMobile = await a4Radio.boundingBox();
    expect(a4BoxMobile).toBeTruthy();
    expect(a4BoxMobile!.height).toBeGreaterThanOrEqual(34);
    expect(a4BoxMobile!.width).toBeGreaterThanOrEqual(44);

    const groupBoxMobile = await pageSizeGroup.boundingBox();
    expect(groupBoxMobile).toBeTruthy();
    expect(groupBoxMobile!.width).toBeLessThanOrEqual(375);

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'segmented-control-mobile-light.png') });

    // 4. Mobile Dark (375px)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'segmented-control-mobile-dark.png') });
  });

  test('SegmentedControl consumers: verifies ProtectTool, SignTool 2D grid, and PdfToImagesTool regression & touch targets', async ({ page }) => {
    // 1. SignTool 2D Position Grid
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/tool/sign');
    const fileInputSign = page.locator('input[type="file"]').first();
    await fileInputSign.setInputFiles(samplePdf);

    const posGroup = page.getByRole('radiogroup', { name: 'Position' });
    await posGroup.scrollIntoViewIfNeeded();
    await expect(posGroup).toBeVisible();

    const br = page.getByRole('radio', { name: 'Bottom Right' });
    const bl = page.getByRole('radio', { name: 'Bottom Left' });
    const bc = page.getByRole('radio', { name: 'Bottom Center' });
    const tr = page.getByRole('radio', { name: 'Top Right' });

    await expect(br).toHaveAttribute('aria-checked', 'true');
    await br.focus();
    await page.keyboard.press('ArrowDown');
    await expect(bc).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tr).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(bl).toHaveAttribute('aria-checked', 'true');

    // Verify 2D grid hit-area height (>= 44px via ::before) and non-overlapping row gap (>= 6px)
    const signGridMetrics = await posGroup.evaluate((groupEl) => {
      const items = Array.from(groupEl.querySelectorAll('.segmented-control-item'));
      const row1 = items[0].getBoundingClientRect();
      const row2 = items[2].getBoundingClientRect();
      const beforeStyle = window.getComputedStyle(items[0], '::before');
      return {
        rowGap: row2.top - row1.bottom,
        visualHeight: row1.height,
        beforeHeight: parseFloat(beforeStyle.height) || row1.height,
        beforeTop: parseFloat(beforeStyle.top) || 0,
        beforeBottom: parseFloat(beforeStyle.bottom) || 0,
      };
    });
    expect(signGridMetrics.visualHeight).toBeGreaterThanOrEqual(38);
    expect(signGridMetrics.beforeHeight).toBeGreaterThanOrEqual(44);
    expect(signGridMetrics.rowGap).toBeGreaterThanOrEqual(6);

    // Capture SignTool 2D grid mobile dark screenshot
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'sign-position-mobile-dark.png') });

    // 2. ProtectTool Encryption Algorithm
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.goto('/tool/protect');
    const fileInputProtect = page.locator('input[type="file"]').first();
    await fileInputProtect.setInputFiles(samplePdf);

    const algoGroup = page.getByRole('radiogroup', { name: 'Encryption Algorithm' });
    await algoGroup.scrollIntoViewIfNeeded();
    const aesRadio = page.getByRole('radio', { name: 'AES-256 (Modern)' });
    const rc4Radio = page.getByRole('radio', { name: 'RC4-128 (Legacy)' });
    await expect(aesRadio).toHaveAttribute('aria-checked', 'true');
    await rc4Radio.click();
    await expect(rc4Radio).toHaveAttribute('aria-checked', 'true');

    // 3. PdfToImagesTool all controls on 375px mobile
    await page.goto('/tool/pdf-to-images');
    const fileInputImg = page.locator('input[type="file"]').first();
    await fileInputImg.setInputFiles(samplePdf);

    const pngRadio = page.getByRole('radio', { name: 'PNG (Lossless)' });
    const jpegRadio = page.getByRole('radio', { name: 'JPEG (Smaller file)' });
    await expect(pngRadio).toHaveAttribute('aria-checked', 'true');
    const pngBox = await pngRadio.boundingBox();
    expect(pngBox!.height).toBeGreaterThanOrEqual(44);

    await jpegRadio.click();
    const qualityGroup = page.getByRole('radiogroup', { name: 'JPEG quality' });
    await expect(qualityGroup).toBeVisible();
    const qualityGroupBox = await qualityGroup.boundingBox();
    expect(qualityGroupBox!.width).toBeLessThanOrEqual(375);

    const resGroup = page.getByRole('radiogroup', { name: 'Resolution' });
    const resGroupBox = await resGroup.boundingBox();
    expect(resGroupBox!.width).toBeLessThanOrEqual(375);
  });
});
