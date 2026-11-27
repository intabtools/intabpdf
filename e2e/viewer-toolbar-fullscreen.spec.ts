import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function createBlankPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 280]);
  }
  return Buffer.from(await doc.save());
}

test.describe('Viewer Toolbar Large Page Counts & Fullscreen Controls', () => {
  test('fits all normal viewer toolbar controls across 9, 40, 100, 500, and 1000 pages on mobile without clipping', async ({
    page,
  }) => {
    const pageCounts = [9, 40, 100, 500, 1000] as const;
    const pdfs = new Map<number, Buffer>();
    for (const count of pageCounts) {
      pdfs.set(count, await createBlankPdf(count));
    }

    for (const width of [360, 411]) {
      await page.setViewportSize({ width, height: 740 });
      for (const count of pageCounts) {
        await page.goto('/viewer?platform=android');
        await page.locator('input[type="file"]').first().setInputFiles({
          name: `doc-${count}.pdf`,
          mimeType: 'application/pdf',
          buffer: pdfs.get(count)!,
        });
        await page.waitForSelector('.vtb-page-badge', { timeout: 15000 });

        // Verify small current page (1 / N) and Share PDF button in normal mode
        await expect(page.locator('.vtb [aria-label="Share PDF"]')).toBeVisible();

        // Jump to the highest page number so full multi-digit strings render in badge
        await page.click('.vtb-page-badge');
        await page.fill('.vtb-page-input', String(count));
        await page.press('.vtb-page-input', 'Enter');
        await expect(page.locator('.vtb-page-badge')).toHaveText(`${count} / ${count}`);

        const badgeCheck = await page.evaluate(() => {
          const vtb = document.querySelector('.vtb') as HTMLElement;
          const vr = vtb.getBoundingClientRect();
          const visibleControls = Array.from(vtb.querySelectorAll('button, .zoom-badge')).filter(
            (el) => getComputedStyle(el).display !== 'none',
          );
          const clipped = visibleControls
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.left < vr.left - 0.5 || r.right > vr.right + 0.5 || r.width < 10;
            })
            .map((el) => el.getAttribute('aria-label') || el.className);
          return {
            overflow: Math.round(vtb.scrollWidth - vtb.clientWidth),
            clipped,
            visibleCount: visibleControls.length,
          };
        });
        expect(badgeCheck.overflow).toBeLessThanOrEqual(0);
        expect(badgeCheck.clipped).toEqual([]);
        expect(badgeCheck.visibleCount).toBeGreaterThanOrEqual(10);

        // Verify inline page-edit mode also stays within viewport without clipping controls
        await page.click('.vtb-page-badge');
        await expect(page.locator('.vtb .vtb-page-input')).toBeVisible();
        const editCheck = await page.evaluate(() => {
          const vtb = document.querySelector('.vtb') as HTMLElement;
          const vr = vtb.getBoundingClientRect();
          const visibleControls = Array.from(vtb.querySelectorAll('button, .zoom-badge, input')).filter(
            (el) => getComputedStyle(el).display !== 'none',
          );
          const clipped = visibleControls
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.left < vr.left - 0.5 || r.right > vr.right + 0.5;
            })
            .map((el) => el.getAttribute('aria-label') || el.className);
          return {
            overflow: Math.round(vtb.scrollWidth - vtb.clientWidth),
            clipped,
          };
        });
        expect(editCheck.overflow).toBeLessThanOrEqual(0);
        expect(editCheck.clipped).toEqual([]);
      }
    }
  });

  test('fullscreen removes Share PDF while polishing and preserving bottom floating pills on mobile and desktop', async ({
    page,
  }) => {
    const pdf = await createBlankPdf(500);

    for (const { width, height, stacked } of [
      { width: 360, height: 720, stacked: true },
      { width: 1280, height: 800, stacked: false },
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/viewer?platform=android');
      await page.locator('input[type="file"]').first().setInputFiles({
        name: 'fullscreen-500.pdf',
        mimeType: 'application/pdf',
        buffer: pdf,
      });
      await page.waitForSelector('.vtb-page-badge', { timeout: 15000 });

      // Normal viewer toolbar retains Share PDF
      await expect(page.locator('.vtb [aria-label="Share PDF"]')).toBeVisible();

      // Enter fullscreen controls
      await page.click('[aria-label="Enter full screen (F)"]');
      await expect(page.locator('.viewer-pill-tl')).toBeVisible();
      await expect(page.locator('.viewer-pill-tr')).toBeVisible();
      await expect(page.locator('.viewer-pill-bc')).toBeVisible();
      await expect(page.locator('.viewer-pill-br')).toBeVisible();

      // Verify dark-theme translucent styling applies cleanly in fullscreen as well
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });
      const darkPillBg = await page
        .locator('.viewer-pill-bc')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(darkPillBg).not.toBe('rgba(0, 0, 0, 0)');

      // Share PDF must NOT appear anywhere inside fullscreen controls
      await expect(page.locator('.viewer-pill [aria-label="Share PDF"]')).toHaveCount(0);

      // Page navigation & Zoom pills still work
      await page.click('.viewer-pill-bc [aria-label="Next page"]');
      await expect(page.locator('.viewer-pill-bc .viewer-pill-badge')).toHaveText('2 / 500');
      await page.click('.viewer-pill-br [aria-label="Zoom in"]');
      await expect(page.locator('.viewer-pill-br .viewer-pill-badge')).toContainText('%');

      // Verify compact pill dimensions and non-overlapping layout within viewport
      const layout = await page.evaluate(() => {
        const tl = document.querySelector('.viewer-pill-tl')!.getBoundingClientRect();
        const tr = document.querySelector('.viewer-pill-tr')!.getBoundingClientRect();
        const bc = document.querySelector('.viewer-pill-bc')!.getBoundingClientRect();
        const br = document.querySelector('.viewer-pill-br')!.getBoundingClientRect();
        return {
          vw: window.innerWidth,
          vh: window.innerHeight,
          tl: { left: tl.left, top: tl.top, right: tl.right, height: tl.height },
          tr: { left: tr.left, top: tr.top, right: tr.right, height: tr.height },
          bc: { left: bc.left, top: bc.top, right: bc.right, bottom: bc.bottom, height: bc.height },
          br: { left: br.left, top: br.top, right: br.right, bottom: br.bottom, height: br.height },
        };
      });

      expect(layout.tl.height).toBeLessThanOrEqual(42);
      expect(layout.tr.height).toBeLessThanOrEqual(42);
      expect(layout.bc.height).toBeLessThanOrEqual(42);
      expect(layout.br.height).toBeLessThanOrEqual(42);
      expect(layout.tl.right).toBeLessThan(layout.tr.left);
      expect(layout.br.right).toBeLessThanOrEqual(layout.vw);
      expect(layout.bc.bottom).toBeLessThanOrEqual(layout.vh);

      if (stacked) {
        // Mobile stacks Zoom pill cleanly above Page Nav pill without overlap
        expect(layout.br.bottom).toBeLessThanOrEqual(layout.bc.top);
      } else {
        // Desktop places Zoom pill cleanly to the right of Page Nav pill without overlap
        expect(layout.bc.right).toBeLessThan(layout.br.left);
      }

      // Exit distraction-free fullscreen and verify normal toolbar returns with Share PDF
      await page.click('.viewer-pill-tl [aria-label="Exit full screen (Esc or F)"]');
      await expect(page.locator('.vtb [aria-label="Share PDF"]')).toBeVisible();
    }
  });
});
