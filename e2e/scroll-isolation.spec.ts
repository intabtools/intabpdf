import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function samplePdfBuffer(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 4; i++) {
    doc.addPage([595, 842]).drawText(`Page ${i} Scroll Isolation`);
  }
  return Buffer.from(await doc.save());
}

test.describe('Phase 9: Page Scroll Isolation Across WebShell and AppShell', () => {
  test('WebShell: isolates Tool -> About, About -> Tool, Tool A -> Tool B, sticky header, and Back/Forward with short intermediate route', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 550 });

    // 1. Open Tool A and scroll down
    await page.goto('/tool/text-to-pdf');
    await page.waitForSelector('textarea', { timeout: 10000 });
    await page.mouse.move(600, 300);
    await page.mouse.wheel(0, 320);
    await page.waitForTimeout(150);

    const toolScroll = await page.evaluate(() => document.querySelector('.wscroll')!.scrollTop);
    expect(toolScroll).toBeGreaterThan(100);

    // 2. Navigate Tool -> About -> About must start at top (0)
    await page.locator('header.wh a[href="/about"]').click();
    await page.waitForSelector('.ab', { timeout: 10000 });
    await page.waitForTimeout(100);
    const aboutStartScroll = await page.evaluate(() => document.querySelector('.wscroll')!.scrollTop);
    expect(aboutStartScroll).toBe(0);

    // Sticky header remains pinned at top after scrolling About
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(150);
    const aboutScrolled = await page.evaluate(() => ({
      wscrollTop: document.querySelector('.wscroll')!.scrollTop,
      headerTop: document.querySelector('header.wh')!.getBoundingClientRect().top,
      windowY: window.scrollY,
    }));
    expect(aboutScrolled.wscrollTop).toBeGreaterThan(100);
    expect(Math.abs(aboutScrolled.headerTop)).toBeLessThanOrEqual(2);
    expect(aboutScrolled.windowY).toBe(0);

    // 3. Navigate About -> Short intermediate Tool (/tool/merge) -> starts at 0
    await page.locator('header.wh nav.wnav a[href="/"]').click();
    await page.waitForSelector('a[href="/tool/merge"]', { timeout: 10000 });
    await page.locator('a[href="/tool/merge"]').first().click();
    await page.waitForSelector('.dz', { timeout: 10000 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.querySelector('.wscroll')!.scrollTop)).toBe(0);

    // 4. Browser Back -> / -> About restores About's saved scroll offset cleanly
    await page.goBack();
    await page.goBack();
    await page.waitForSelector('.ab', { timeout: 10000 });
    await page.waitForTimeout(250);
    const aboutRestored = await page.evaluate(() => document.querySelector('.wscroll')!.scrollTop);
    expect(Math.abs(aboutRestored - aboutScrolled.wscrollTop)).toBeLessThanOrEqual(4);

    // 5. Browser Back again -> /tool/text-to-pdf restores Tool A's saved scroll offset
    await page.goBack();
    await page.waitForSelector('textarea', { timeout: 10000 });
    await page.waitForTimeout(250);
    const toolRestored = await page.evaluate(() => document.querySelector('.wscroll')!.scrollTop);
    expect(Math.abs(toolRestored - toolScroll)).toBeLessThanOrEqual(4);

    // 6. Browser Forward -> /about restores About's saved offset again
    await page.goForward();
    await page.waitForSelector('.ab', { timeout: 10000 });
    await page.waitForTimeout(250);
    const aboutForwarded = await page.evaluate(() => document.querySelector('.wscroll')!.scrollTop);
    expect(Math.abs(aboutForwarded - aboutScrolled.wscrollTop)).toBeLessThanOrEqual(4);
  });

  test('AppShell (Electron/Mobile): isolates scroll across routes, preserves fixed nav and independent PDF viewer scroll', async ({ page }) => {
    // Desktop AppShell
    await page.setViewportSize({ width: 1280, height: 550 });
    await page.goto('/tool/text-to-pdf?platform=electron');
    await page.waitForSelector('textarea', { timeout: 10000 });

    await page.mouse.move(700, 300);
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(150);
    const appToolScroll = await page.evaluate(() => document.querySelector('#main-content')!.scrollTop);
    expect(appToolScroll).toBeGreaterThan(50);

    // Navigate Tool -> About
    await page.locator('.sb a[href="/about"]').click();
    await page.waitForSelector('.ab', { timeout: 10000 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.querySelector('#main-content')!.scrollTop)).toBe(0);

    // Scroll About and navigate About -> Tool (/tool/protect)
    await page.evaluate(() => {
      const main = document.querySelector('#main-content')!;
      main.scrollTop = 180;
    });
    await page.waitForTimeout(150);
    const appAboutScroll = await page.evaluate(() => document.querySelector('#main-content')!.scrollTop);
    expect(appAboutScroll).toBeGreaterThan(80);

    await page.locator('.sb a[href="/tool/protect"]').click();
    await page.waitForSelector('.dz', { timeout: 10000 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.querySelector('#main-content')!.scrollTop)).toBe(0);

    // Back restores About's exact scroll
    await page.goBack();
    await page.waitForSelector('.ab', { timeout: 10000 });
    await page.waitForTimeout(250);
    const appAboutRestored = await page.evaluate(() => document.querySelector('#main-content')!.scrollTop);
    expect(Math.abs(appAboutRestored - appAboutScroll)).toBeLessThanOrEqual(4);

    // Viewer internal scroll (.cvs) remains completely independent
    const pdfBuf = await samplePdfBuffer();
    await page.locator('.sb a[href="/viewer"]').click();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'viewer-scroll.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuf,
    });
    await page.waitForSelector('.pg-item[data-page="1"] .textLayer span', { timeout: 15000 });
    await page.locator('.pg-item[data-page="4"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.querySelector('.cvs')!.scrollTop)).toBeGreaterThan(200);
    expect(await page.evaluate(() => document.querySelector('#main-content')!.scrollTop)).toBe(0);

    // Mobile Web layout (375x600)
    await page.setViewportSize({ width: 375, height: 600 });
    await page.goto('/tool/merge');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'mobile.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuf,
    });
    await page.waitForSelector('.tp > .card.opts button.cta', { timeout: 10000 });
    await page.mouse.move(200, 350);
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.querySelector('.wscroll')!.scrollTop)).toBeGreaterThan(100);

    await page.locator('header.wh a[href="/about"]').click();
    await page.waitForSelector('.ab', { timeout: 10000 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.querySelector('.wscroll')!.scrollTop)).toBe(0);
  });
});
