import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePdf = path.resolve(__dirname, 'fixtures/sample.pdf');

test.describe('Phase 1 & 2: CommandPalette search and Tool UI layout consistency', () => {
  test('CommandPalette finds all 13 tools, multi-word queries, aliases, and respects web/electron viewer availability', async ({ page }) => {
    await page.goto('/?platform=electron');
    await page.locator('.hs, .hsi').first().click();
    const searchInput = page.getByRole('textbox', { name: 'Search tools' });
    await expect(searchInput).toBeVisible();

    const emptyOptions = page.locator('#pl button.pi');
    expect(await emptyOptions.count()).toBe(16);
    await expect(page.locator('#pl')).toContainText('PDF Viewer');
    await expect(page.locator('#pl')).toContainText('Extract text');

    for (const [query, expected] of [
      ['Protect PDF', 'Protect'],
      ['Unlock PDF', 'Unlock'],
      ['Reorder PDF', 'Reorder pages'],
      ['Sign PDF', 'Sign'],
      ['Merge PDF', 'Merge'],
      ['Split PDF', 'Split'],
      ['Compress PDF', 'Compress'],
      ['Text to PDF', 'Text to PDF'],
      ['Remove pages', 'Remove pages'],
      ['Rotate pages', 'Rotate pages'],
      ['PDF to images', 'PDF to images'],
      ['Images to PDF', 'Images to PDF'],
      ['Extract text', 'Extract text'],
      ['encrypt', 'Protect'],
      ['decrypt', 'Unlock'],
      ['rearrange', 'Reorder pages'],
      ['signature', 'Sign'],
      ['shrink', 'Compress'],
    ]) {
      await searchInput.fill(query);
      await expect(page.locator('#pl button.pi').first()).toContainText(expected);
    }

    for (const [alias, expected] of [
      ['jpg', 'PDF to images'],
      ['png', 'Images to PDF'],
    ]) {
      await searchInput.fill(alias);
      await expect(page.locator('#pl')).toContainText(expected);
    }

    await page.keyboard.press('Escape');
    await expect(searchInput).toBeHidden();

    // On Web, PDF Viewer entry must be excluded
    await page.goto('/');
    await page.locator('.wsb, .wsi').first().click();
    await expect(page.getByRole('textbox', { name: 'Search tools' })).toBeVisible();
    await expect(page.locator('#pl')).not.toContainText('PDF Viewer');
    expect(await page.locator('#pl button.pi').count()).toBe(15);
  });

  test('Two-column tools maintain consistent padding, column placement, dividers, and >=44px mobile CTAs', async ({ page }) => {
    // Desktop two-column verification
    await page.setViewportSize({ width: 1280, height: 800 });

    for (const route of ['/tool/unlock', '/tool/protect', '/tool/sign', '/tool/reorder']) {
      await page.goto(route);
      await page.locator('input[type="file"]').first().setInputFiles(samplePdf);
      await page.waitForSelector('.tp > .card.opts button.cta', { timeout: 10000 });
      await page.waitForSelector('.tp > .tp-work', { timeout: 10000 });

      const metrics = await page.evaluate(() => {
        const tp = document.querySelector('.tp')!;
        const staged = document.querySelector('.tp > .tp-staged')!;
        const work = document.querySelector('.tp > .tp-work')!;
        const opts = document.querySelector('.tp > .card.opts')!;
        const workStyle = getComputedStyle(work);
        const optsStyle = getComputedStyle(opts);
        const lastSw = Array.from(opts.querySelectorAll('.sw')).pop();
        const tpRect = tp.getBoundingClientRect();
        const stagedRect = staged.getBoundingClientRect();
        const workRect = work.getBoundingClientRect();
        const optsRect = opts.getBoundingClientRect();
        return {
          workPaddingTop: parseFloat(workStyle.paddingTop),
          workPaddingLeft: parseFloat(workStyle.paddingLeft),
          optsPaddingTop: parseFloat(optsStyle.paddingTop),
          lastSwBorderBottom: lastSw ? parseFloat(getComputedStyle(lastSw).borderBottomWidth) : 0,
          stagedWidth: stagedRect.width,
          workWidth: workRect.width,
          optsLeft: optsRect.left,
          workRight: workRect.right,
          optsTop: optsRect.top,
          stagedTop: stagedRect.top,
          overflowX: tpRect.right > window.innerWidth + 1,
        };
      });

      expect(metrics.workPaddingTop).toBeGreaterThanOrEqual(16);
      expect(metrics.workPaddingLeft).toBeGreaterThanOrEqual(16);
      expect(metrics.optsPaddingTop).toBeGreaterThanOrEqual(16);
      expect(metrics.lastSwBorderBottom).toBe(0);
      expect(metrics.workWidth).toBeGreaterThan(500);
      expect(metrics.optsLeft).toBeGreaterThanOrEqual(metrics.workRight - 1);
      expect(Math.abs(metrics.optsTop - metrics.stagedTop)).toBeLessThanOrEqual(2);
      expect(metrics.overflowX).toBe(false);
    }

    // Mobile single-column verification & >=44px CTA hit targets
    await page.setViewportSize({ width: 375, height: 720 });
    for (const route of ['/tool/unlock', '/tool/protect', '/tool/merge']) {
      await page.goto(route);
      await page.locator('input[type="file"]').first().setInputFiles(samplePdf);
      await page.waitForSelector('.tp > .card.opts button.cta', { timeout: 10000 });

      const mobileCheck = await page.evaluate(() => {
        const cta = document.querySelector('.tp > .card.opts button.cta')!;
        const rect = cta.getBoundingClientRect();
        return {
          ctaHeight: rect.height,
          docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });

      expect(mobileCheck.ctaHeight).toBeGreaterThanOrEqual(44);
      expect(mobileCheck.docOverflow).toBe(false);
    }
  });
});
