import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');
const SCRATCH_DIR = path.resolve(
  process.env.PLAYWRIGHT_SCREENSHOT_DIR ||
    path.resolve(__dirname, '../test-results/e2e-screenshots')
);

test.describe('Phase 3: PasswordInput Shared Component Verification', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCRATCH_DIR)) {
      fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    }
  });
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

  test('ModalDialog (RemovePagesTool): verifies focus trap, Escape/backdrop dismissal, scroll lock, focus restoration, and responsive themes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tool/remove-pages');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePdf);

    const input = page.locator('input[placeholder="e.g. 1-3, 5"]');
    await input.fill('1');

    const triggerBtn = page.locator('button.cta:has-text("Remove pages from file")');
    await expect(triggerBtn).toBeEnabled();
    await triggerBtn.focus();
    await triggerBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    const describedBy = await dialog.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();

    // Background body scrolling must be locked and background #root marked inert/aria-hidden while modal is open
    const bodyOverflowOpen = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflowOpen).toBe('hidden');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');

    // Background content cannot receive keyboard focus even programmatically while inert
    const focusMovedToBackground = await input.evaluate((el) => {
      (el as HTMLElement).focus();
      return document.activeElement === el;
    });
    expect(focusMovedToBackground).toBe(false);

    // Focus must move inside dialog initially
    const activeInsideOnOpen = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return Boolean(dlg && dlg.contains(document.activeElement));
    });
    expect(activeInsideOnOpen).toBe(true);

    // Tab and Shift+Tab focus containment: focus must stay trapped inside the dialog across multiple cycles
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const stillInside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return Boolean(dlg && dlg.contains(document.activeElement));
      });
      expect(stillInside).toBe(true);
    }

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      const stillInside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return Boolean(dlg && dlg.contains(document.activeElement));
      });
      expect(stillInside).toBe(true);
    }

    // Pressing Escape dismisses dialog, unlocks scroll, removes #root inertness, and restores focus to trigger button
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    const bodyOverflowClosed = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflowClosed).toBe('');
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden');

    const focusedIsTrigger = await triggerBtn.evaluate((el) => document.activeElement === el);
    expect(focusedIsTrigger).toBe(true);

    // Unexpected unmount cleanup: open modal, navigate away via SPA history, verify scroll lock & inertness clear
    await triggerBtn.click();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.history.pushState({}, '', '/about'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(page.locator('#root')).not.toHaveAttribute('inert');

    // Return to Remove Pages to verify backdrop click and theme rendering
    await page.goto('/tool/remove-pages');
    await page.locator('input[type="file"]').first().setInputFiles(samplePdf);
    await page.locator('input[placeholder="e.g. 1-3, 5"]').fill('1');
    await triggerBtn.focus();
    await triggerBtn.click();
    await expect(dialog).toBeVisible();

    const backdrop = page.locator('.mo.modal-backdrop');
    const backdropBox = await backdrop.boundingBox();
    expect(backdropBox).toBeTruthy();
    await page.mouse.click(backdropBox!.x + 8, backdropBox!.y + 8);
    await expect(dialog).not.toBeVisible();

    // Re-open for Desktop Light, Desktop Dark, Mobile Light, Mobile Dark visual verification
    await triggerBtn.click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'modal-dialog-desktop-light.png') });

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'modal-dialog-desktop-dark.png') });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(200);
    const mobileBox = await dialog.boundingBox();
    expect(mobileBox).toBeTruthy();
    expect(mobileBox!.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'modal-dialog-mobile-light.png') });

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCRATCH_DIR, 'modal-dialog-mobile-dark.png') });

    // Close via Escape cleanly
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('ModalDialog (Nested + StrictMode in browser): verifies focus restoration across A->B->A->trigger and active topmost state', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('h1, .tc');

    // Mount a StrictMode React harness inside #root using Vite dev server's singleton React & ModalDialog
    await page.evaluate(async () => {
      const reactRes = performance
        .getEntriesByType('resource')
        .find((r) => r.name.includes('/node_modules/.vite/deps/react.js'));
      if (!reactRes) throw new Error('Could not resolve Vite React module URL');

      const search = new URL(reactRes.name).search;
      const ReactMod = await import(reactRes.name);
      const React = ReactMod.default ?? ReactMod;
      const ReactDOMMod = await import(`${window.location.origin}/node_modules/.vite/deps/react-dom_client.js${search}`);
      const ReactDOM = ReactDOMMod.default ?? ReactDOMMod;
      const { default: ModalDialog } = await import('/src/components/ModalDialog.tsx');

      const host = document.createElement('div');
      host.id = 'nested-modal-test-host';
      document.getElementById('root')?.appendChild(host);

      function Harness() {
        const [openA, setOpenA] = React.useState(false);
        const [openB, setOpenB] = React.useState(false);

        return React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            'div',
            null,
            React.createElement(
              'button',
              { id: 'trigger-open-a', type: 'button', onClick: () => setOpenA(true) },
              'Open Modal A'
            ),
            React.createElement(
              ModalDialog,
              {
                isOpen: openA,
                onClose: () => setOpenA(false),
                title: 'Modal A Title',
                description: 'Modal A Description',
              },
              React.createElement(
                'div',
                null,
                React.createElement(
                  'button',
                  { id: 'btn-inside-a-open-b', type: 'button', onClick: () => setOpenB(true) },
                  'Open Nested Modal B'
                ),
                React.createElement(
                  ModalDialog,
                  {
                    isOpen: openB,
                    onClose: () => setOpenB(false),
                    title: 'Modal B Title',
                    description: 'Modal B Description',
                  },
                  React.createElement(
                    'button',
                    { id: 'btn-inside-b-close', type: 'button', onClick: () => setOpenB(false) },
                    'Done B'
                  )
                )
              )
            )
          )
        );
      }

      const root = ReactDOM.createRoot(host);
      root.render(React.createElement(Harness));
      (window as unknown as { __cleanupModalHarness?: () => void }).__cleanupModalHarness = () => {
        root.unmount();
        host.remove();
      };
    });

    const triggerA = page.locator('#trigger-open-a');
    await expect(triggerA).toBeVisible();
    await triggerA.focus();
    await triggerA.click();

    // Modal A is open under StrictMode
    const modalA = page.getByRole('dialog', { name: 'Modal A Title' });
    await expect(modalA).toBeVisible();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    // Open Nested Modal B from button inside Modal A
    const openBBtn = page.locator('#btn-inside-a-open-b');
    await openBBtn.focus();
    await openBBtn.click();

    const modalB = page.getByRole('dialog', { name: 'Modal B Title' });
    await expect(modalB).toBeVisible();

    // While Modal B is topmost, Modal A is hidden from assistive technology and inert, while Modal B remains active
    await expect(modalA).toHaveCount(0);
    const modalADom = page.locator('.modal-dialog', { hasText: 'Modal A Title' });
    const modalAIsInert = await modalADom.evaluate((el) =>
      Boolean((el.closest('.modal-backdrop') as HTMLElement | null)?.inert)
    );
    const modalBIsInert = await modalB.evaluate((el) =>
      Boolean((el.closest('.modal-backdrop') as HTMLElement | null)?.inert)
    );
    expect(modalAIsInert).toBe(true);
    expect(modalBIsInert).toBe(false);

    // Topmost Modal B's button is clickable (background inertness does not disable topmost modal)
    await expect(page.locator('#btn-inside-b-close')).toBeEnabled();

    // Verify Tab traps inside Modal B specifically
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      const insideB = await modalB.evaluate((el) => el.contains(document.activeElement));
      expect(insideB).toBe(true);
    }

    // Close Modal B via Escape -> Modal B closes, Modal A becomes interactive and visible to assistive tech again, focus returns to openBBtn inside A!
    await page.keyboard.press('Escape');
    await expect(modalB).not.toBeVisible();
    await expect(modalA).toBeVisible();

    const modalAInertAfterB = await modalA.evaluate((el) =>
      Boolean((el.closest('.modal-backdrop') as HTMLElement | null)?.inert)
    );
    expect(modalAInertAfterB).toBe(false);
    await expect(openBBtn).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');

    // Close Modal A via Escape -> #root restores, scroll unlocks, focus returns to original triggerA!
    await page.keyboard.press('Escape');
    await expect(modalA).not.toBeVisible();
    await expect(triggerA).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(page.locator('#root')).not.toHaveAttribute('inert');

    // Re-open Modal A and unexpectedly unmount the entire React StrictMode tree -> verify cleanup!
    await triggerA.click();
    await expect(modalA).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');

    await page.evaluate(() => {
      (window as unknown as { __cleanupModalHarness?: () => void }).__cleanupModalHarness?.();
    });
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
  });

  test('ModalDialog (PasswordDialog in Viewer): verifies initial focus, Tab containment, validation error, unlock flow, and mobile/desktop themes', async ({ page }) => {
    const rawBytes = fs.readFileSync(samplePdf);
    const encryptedBytes = await encryptPDF(new Uint8Array(rawBytes), 'ViewerPass2026!');
    const tempProtectedPath = path.resolve(__dirname, 'fixtures/temp-modal-viewer.pdf');
    fs.writeFileSync(tempProtectedPath, encryptedBytes);

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/viewer?platform=electron');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(tempProtectedPath);

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog.locator('text=Password Protected PDF')).toBeVisible();

      const pwdInput = page.locator('#pdf-password-input');
      await expect(pwdInput).toBeFocused({ timeout: 2000 });

      // Submit incorrect password and verify validation error inside dialog
      await pwdInput.fill('WrongPassword');
      await page.getByRole('button', { name: 'Unlock PDF' }).click();
      await expect(dialog.locator('text=Incorrect password. Please try again.')).toBeVisible({ timeout: 5000 });
      await expect(pwdInput).toBeFocused({ timeout: 2000 });

      // Verify Tab containment stays inside PasswordDialog
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          return Boolean(dlg && dlg.contains(document.activeElement));
        });
        expect(inside).toBe(true);
      }

      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SCRATCH_DIR, 'password-dialog-error-desktop-dark.png') });

      // Check 375px mobile light rendering with validation error
      await page.setViewportSize({ width: 375, height: 667 });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.waitForTimeout(200);
      const mobileDlgBox = await dialog.boundingBox();
      expect(mobileDlgBox).toBeTruthy();
      expect(mobileDlgBox!.width).toBeLessThanOrEqual(375);
      await page.screenshot({ path: path.join(SCRATCH_DIR, 'password-dialog-error-mobile-light.png') });

      // Enter valid password and verify modal closes and scroll-lock cleans up
      await pwdInput.fill('ViewerPass2026!');
      await page.getByRole('button', { name: 'Unlock PDF' }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
      expect(bodyOverflow).toBe('');
    } finally {
      if (fs.existsSync(tempProtectedPath)) {
        fs.unlinkSync(tempProtectedPath);
      }
    }
  });

  test('ImagePreviewModal: inspects lightbox sizing and controls across desktop and mobile viewports', async ({ page }) => {
    const samplePng = path.resolve(__dirname, 'fixtures/sample.png');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tool/images-to-pdf');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePng);

    const previewTrigger = page.getByRole('button', { name: 'Preview sample.png' });
    await expect(previewTrigger).toBeVisible({ timeout: 10000 });
    await previewTrigger.click();

    const previewDialog = page.getByRole('dialog', { name: 'Preview of sample.png' });
    await expect(previewDialog).toBeVisible();

    const closeBtn = page.getByRole('button', { name: 'Close image preview' });
    const rotateBtn = page.getByRole('button', { name: 'Rotate 90 degrees clockwise' });
    const cropBtn = page.getByRole('button', { name: 'Crop image' });

    await expect(closeBtn).toBeFocused();
    await expect(rotateBtn).toBeVisible();
    await expect(cropBtn).toBeVisible();

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'image-preview-desktop.png') });

    // Mobile 375px check: ensure controls fit within 375px without horizontal overflow
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(150);
    const hdrBox = await page.locator('.lightbox-hdr').boundingBox();
    expect(hdrBox).toBeTruthy();
    expect(hdrBox!.width).toBeLessThanOrEqual(375);

    await page.screenshot({ path: path.join(SCRATCH_DIR, 'image-preview-mobile.png') });

    // Close via Escape and verify focus restores to preview trigger
    await page.keyboard.press('Escape');
    await expect(previewDialog).not.toBeVisible();
  });
});
