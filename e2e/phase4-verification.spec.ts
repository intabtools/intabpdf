import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');
const samplePng = path.resolve(__dirname, 'fixtures/sample.png');
const invalidFile = path.resolve(__dirname, 'fixtures/invalid.txt');
const SCRATCH_DIR = path.resolve(
  process.env.PLAYWRIGHT_SCREENSHOT_DIR ||
    path.resolve(__dirname, '../test-results/e2e-screenshots')
);

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  // Wait for 0.15s theme transitions to settle before inspecting styles or capturing screenshots.
  await page.waitForTimeout(200);
}

async function assertNoHorizontalOverflow(page: Page, viewportWidth: number): Promise<void> {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
}

async function getContrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const parseRgb = (cssColor: string): [number, number, number, number] => {
      const match = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return [0, 0, 0, 1];
      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] !== undefined ? Number(match[4]) : 1,
      ];
    };

    const resolveBg = (node: Element | null): [number, number, number] => {
      let current: Element | null = node;
      while (current) {
        const bg = parseRgb(getComputedStyle(current).backgroundColor);
        if (bg[3] > 0.9) return [bg[0], bg[1], bg[2]];
        current = current.parentElement;
      }
      const rootBg = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
      return [rootBg[0], rootBg[1], rootBg[2]];
    };

    const relativeLuminance = (r: number, g: number, b: number): number => {
      const toLinear = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    };

    const style = getComputedStyle(el);
    const fg = parseRgb(style.color);
    const bgRaw = parseRgb(style.backgroundColor);
    const bg = bgRaw[3] > 0.9 ? [bgRaw[0], bgRaw[1], bgRaw[2]] : resolveBg(el.parentElement);

    // Alpha-blend translucent background onto solid parent when needed (e.g. --accent-soft).
    const effectiveBg: [number, number, number] =
      bgRaw[3] > 0 && bgRaw[3] < 1
        ? (() => {
            const base = resolveBg(el.parentElement);
            const a = bgRaw[3];
            return [
              bgRaw[0] * a + base[0] * (1 - a),
              bgRaw[1] * a + base[1] * (1 - a),
              bgRaw[2] * a + base[2] * (1 - a),
            ];
          })()
        : [bg[0], bg[1], bg[2]];

    const l1 = relativeLuminance(fg[0], fg[1], fg[2]);
    const l2 = relativeLuminance(effectiveBg[0], effectiveBg[1], effectiveBg[2]);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  });
}

test.describe('Phase 4 Full-Project Visual Consistency & Accessibility Audit', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCRATCH_DIR)) {
      fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    }
  });
  test('Home and About screens render cleanly without overflow at 375px, 768px, and 1280px in light and dark themes', async ({
    page,
  }) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await page.goto('/');
      await page.waitForLoadState('networkidle');
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await assertNoHorizontalOverflow(page, vp.width);
        await page.screenshot({
          path: path.join(SCRATCH_DIR, `p4-home-${vp.name}-${theme}.png`),
        });
      }

      await page.goto('/about');
      await page.waitForLoadState('networkidle');
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await assertNoHorizontalOverflow(page, vp.width);
        await page.screenshot({
          path: path.join(SCRATCH_DIR, `p4-about-${vp.name}-${theme}.png`),
        });
      }
    }
  });

  test('SignTool tabs support accessible roles, keyboard navigation, high dark-mode contrast, and responsive wrapping', async ({
    page,
  }) => {
    await page.goto('/tool/sign');
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePdf);

    const tablist = page.getByRole('tablist', { name: 'Signature creation modes' });
    await expect(tablist).toBeVisible({ timeout: 10000 });

    const drawTab = page.getByRole('tab', { name: 'Draw' });
    const typeTab = page.getByRole('tab', { name: 'Type' });
    const uploadTab = page.getByRole('tab', { name: 'Upload' });

    const drawPanel = page.locator('#sign-panel-draw');
    const typePanel = page.locator('#sign-panel-type');
    const uploadPanel = page.locator('#sign-panel-upload');

    // Verify all tab ARIA links point to mounted panels and inactive panels are hidden
    await expect(drawTab).toHaveAttribute('aria-selected', 'true');
    await expect(drawTab).toHaveAttribute('tabindex', '0');
    await expect(typeTab).toHaveAttribute('aria-selected', 'false');
    await expect(typeTab).toHaveAttribute('tabindex', '-1');
    await expect(uploadTab).toHaveAttribute('aria-selected', 'false');
    await expect(uploadTab).toHaveAttribute('tabindex', '-1');

    await expect(drawTab).toHaveAttribute('aria-controls', 'sign-panel-draw');
    await expect(typeTab).toHaveAttribute('aria-controls', 'sign-panel-type');
    await expect(uploadTab).toHaveAttribute('aria-controls', 'sign-panel-upload');
    await expect(drawPanel).toHaveAttribute('aria-labelledby', 'sign-tab-draw');
    await expect(typePanel).toHaveAttribute('aria-labelledby', 'sign-tab-type');
    await expect(uploadPanel).toHaveAttribute('aria-labelledby', 'sign-tab-upload');

    await expect(drawPanel).toBeVisible();
    await expect(typePanel).toBeHidden();
    await expect(uploadPanel).toBeHidden();

    // Draw on the canvas so we can verify switching tabs preserves the drawn signature
    const canvas = drawPanel.locator('canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.move(canvasBox!.x + 40, canvasBox!.y + 40);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + 120, canvasBox!.y + 90);
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Clear signature canvas' })).toBeEnabled();

    // Verify ArrowRight, End, Home, and wrapping keyboard navigation
    await drawTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(typeTab).toBeFocused();
    await expect(typeTab).toHaveAttribute('aria-selected', 'true');
    await expect(typePanel).toBeVisible();
    await expect(drawPanel).toBeHidden();
    await expect(page.locator('#sign-typed-name')).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(uploadTab).toBeFocused();
    await expect(uploadTab).toHaveAttribute('aria-selected', 'true');
    await expect(uploadPanel).toBeVisible();

    // Wrapping forward from Upload -> Draw preserves the previously drawn strokes
    await page.keyboard.press('ArrowRight');
    await expect(drawTab).toBeFocused();
    await expect(drawTab).toHaveAttribute('aria-selected', 'true');
    await expect(drawPanel).toBeVisible();
    const preservedNonEmptyCanvas = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext('2d');
      if (!ctx) return false;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      return data.some((channel, idx) => idx % 4 === 3 && channel > 0);
    });
    expect(preservedNonEmptyCanvas).toBe(true);

    // Home / End / ArrowLeft navigation
    await page.keyboard.press('End');
    await expect(uploadTab).toBeFocused();
    await page.keyboard.press('Home');
    await expect(drawTab).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(uploadTab).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(typeTab).toBeFocused();

    // Check active tab text contrast in light and dark mode
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      const contrast = await getContrastRatio(typeTab);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }

    for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setTheme(page, 'dark');
      await assertNoHorizontalOverflow(page, vp.width);
      await page.screenshot({
        path: path.join(SCRATCH_DIR, `p4-sign-${vp.name}-dark.png`),
      });
    }
  });

  test('ImagesToPdfTool uses SegmentedControl radiogroups and opens ImagePreviewModal cleanly across themes', async ({
    page,
  }) => {
    await page.goto('/tool/images-to-pdf');
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(samplePng);

    // Wait for staged file and all 6 SegmentedControl radiogroups
    const radioGroups = page.getByRole('radiogroup');
    await expect(radioGroups.first()).toBeVisible({ timeout: 10000 });
    expect(await radioGroups.count()).toBe(6);

    // Verify option changes update dependent selectors cleanly and execute PDF generation
    await page.getByRole('radio', { name: 'Fit to photo (Natural)', exact: true }).click();
    expect(await radioGroups.count()).toBe(5);
    await page.getByRole('radio', { name: 'A4 paper (Standard)', exact: true }).click();
    expect(await radioGroups.count()).toBe(6);

    await page.getByRole('radio', { name: 'Cover (Fill page)', exact: true }).click();
    expect(await radioGroups.count()).toBe(5);
    await page.getByRole('radio', { name: 'Contain (Full photo)', exact: true }).click();
    expect(await radioGroups.count()).toBe(6);

    await page.getByRole('radio', { name: 'Landscape', exact: true }).click();
    await page.getByRole('radio', { name: 'Standard', exact: true }).click();
    await page.getByRole('radio', { name: 'Clean B&W', exact: true }).click();

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const theme = vp.name === 'mobile' ? 'dark' : 'light';
      await setTheme(page, theme);
      await assertNoHorizontalOverflow(page, vp.width);
      await page.screenshot({
        path: path.join(SCRATCH_DIR, `p4-images-to-pdf-${vp.name}-${theme}.png`),
      });
    }

    // Open ImagePreviewModal from staged thumbnail button
    await page.setViewportSize({ width: 375, height: 667 });
    await setTheme(page, 'dark');
    const previewBtn = page.getByRole('button', { name: /Preview sample\.png/i });
    await expect(previewBtn).toBeVisible();
    await previewBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(200);
    await assertNoHorizontalOverflow(page, 375);
    await page.screenshot({
      path: path.join(SCRATCH_DIR, 'p4-image-preview-mobile-dark.png'),
    });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Execute PDF generation using the updated SegmentedControl options
    const createPdfBtn = page.locator('button.cta', { hasText: /Create PDF from/i });
    await expect(createPdfBtn).toBeEnabled();
    await createPdfBtn.click();
    await expect(page.getByRole('button', { name: /Save PDF/i })).toBeVisible({ timeout: 10000 });
  });

  test('Error states show readable Try again button in dark mode and ToolResultCard actions render consistently', async ({
    page,
  }) => {
    // Part A: Validation NoticeBanner error on SplitTool
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/tool/split');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="file"]').first().setInputFiles(invalidFile);
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5000 });
    await setTheme(page, 'dark');
    await assertNoHorizontalOverflow(page, 375);
    await page.screenshot({
      path: path.join(SCRATCH_DIR, 'p4-split-error-mobile-dark.png'),
    });

    // Part B: Runtime failure in ToolStatusCards ("Operation failed" + "Try again")
    await page.goto('/tool/merge');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="file"]').first().setInputFiles([
      {
        name: 'corrupt-a.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('not a valid pdf document'),
      },
      {
        name: 'corrupt-b.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('still not a valid pdf'),
      },
    ]);
    const mergeBtn = page.locator('button.cta', { hasText: /Merge/i });
    await expect(mergeBtn).toBeEnabled({ timeout: 5000 });
    await mergeBtn.click();

    const retryBtn = page.getByRole('button', { name: 'Try again' });
    await expect(retryBtn).toBeVisible({ timeout: 10000 });

    await setTheme(page, 'dark');
    const retryContrast = await getContrastRatio(retryBtn);
    expect(retryContrast).toBeGreaterThanOrEqual(4.5);
    await assertNoHorizontalOverflow(page, 375);
    await page.screenshot({
      path: path.join(SCRATCH_DIR, 'p4-status-error-mobile-dark.png'),
    });

    // Part C: Successful ToolResultCard (Extract Text)
    await page.goto('/tool/extract-text');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="file"]').first().setInputFiles(samplePdf);
    const extractBtn = page.locator('button.cta', { hasText: /Extract/i });
    await expect(extractBtn).toBeEnabled({ timeout: 5000 });
    await extractBtn.click();

    const chooseAnotherBtn = page.getByRole('button', { name: /Choose another PDF/i });
    await expect(chooseAnotherBtn).toBeVisible({ timeout: 10000 });

    for (const [vp, theme] of [
      [VIEWPORTS[0], 'dark'],
      [VIEWPORTS[2], 'light'],
    ] as const) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setTheme(page, theme);
      await assertNoHorizontalOverflow(page, vp.width);
      await page.screenshot({
        path: path.join(SCRATCH_DIR, `p4-result-${vp.name}-${theme}.png`),
      });
    }
  });

  test('RemovePagesTool confirmation modal and Electron Viewer screen work cleanly across viewports', async ({
    page,
  }) => {
    // RemovePagesTool disabled state -> ModalDialog open
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tool/remove-pages');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="file"]').first().setInputFiles(samplePdf);

    const removeBtn = page.locator('button.cta', { hasText: /Remove pages/i });
    await expect(removeBtn).toBeDisabled({ timeout: 5000 });

    const pageInput = page.locator('input[placeholder="e.g. 1-3, 5"]');
    await pageInput.fill('1');
    await expect(removeBtn).toBeEnabled();
    await removeBtn.click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await setTheme(page, 'dark');
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(SCRATCH_DIR, 'p4-remove-modal-desktop-dark.png'),
    });
    await page.keyboard.press('Escape');
    await expect(confirmDialog).toBeHidden();

    // PDF Viewer with ?platform=electron
    await page.goto('/viewer?platform=electron');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="file"]').first().setInputFiles(samplePdf);

    const searchBtn = page.getByRole('button', { name: /Find text in document/i });
    await expect(searchBtn).toBeVisible({ timeout: 10000 });

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const theme = vp.name === 'mobile' ? 'dark' : 'light';
      await setTheme(page, theme);
      await assertNoHorizontalOverflow(page, vp.width);
      await page.screenshot({
        path: path.join(SCRATCH_DIR, `p4-viewer-${vp.name}-${theme}.png`),
      });
    }
  });
});
