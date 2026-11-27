import { test, expect } from '@playwright/test';
import { PDFDocument, degrees } from 'pdf-lib';
import { protectPdf } from '../src/core/protect';

async function buildTestPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  const p1 = doc.addPage([595, 842]);
  p1.drawText('FirstPage Selectable Word Alpha Bravo', { x: 72, y: 740, size: 18 });
  p1.drawText('SecondLine Charlie Delta Echo', { x: 72, y: 700, size: 18 });

  const p2 = doc.addPage([595, 842]);
  p2.setRotation(degrees(90));
  p2.drawText('RotatedNinety Golf Hotel India', { x: 72, y: 740, size: 18 });

  const p3 = doc.addPage([595, 842]);
  p3.setRotation(degrees(180));
  p3.drawText('RotatedOneEighty Juliet Kilo', { x: 72, y: 740, size: 18 });

  const p4 = doc.addPage([595, 842]);
  p4.setRotation(degrees(270));
  p4.drawText('RotatedTwoSeventy Lima Mike', { x: 72, y: 740, size: 18 });

  const p5 = doc.addPage([595, 842]);
  p5.drawText('FifthPage November Oscar Papa', { x: 72, y: 740, size: 18 });

  return await doc.save();
}

test.describe('Phase 4, 5, 6 & 7: PDF Viewer Selection, Rotation, Copy & Permissions', () => {
  test('aligns text layers on 90/180/270 rotated pages, supports double-click word select, zoom, scroll preservation, Ctrl+A, copy, and share menu', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const pdfBytes = await buildTestPdfBytes();

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/viewer?platform=electron');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'viewer-test.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    });

    await page.waitForSelector('.pg-item[data-page="1"] .textLayer span', { timeout: 15000 });
    await page.waitForTimeout(300);

    // 1. Share PDF button present in viewer toolbar
    await expect(page.getByRole('button', { name: 'Share PDF' })).toBeVisible();

    // 2. Rotated pages 90°, 180°, 270° must match canvas dimensions & have transform applied
    for (const [pageNum, expectedRotation] of [
      [2, '90'],
      [3, '180'],
      [4, '270'],
    ] as const) {
      await page.locator(`.pg-item[data-page="${pageNum}"]`).scrollIntoViewIfNeeded();
      await page.waitForSelector(`.pg-item[data-page="${pageNum}"] .textLayer span`, { timeout: 10000 });
      await page.waitForTimeout(250);

      const box = await page.evaluate((p) => {
        const pg = document.querySelector(`.pg-item[data-page="${p}"]`)!;
        const canvas = pg.querySelector('canvas')!.getBoundingClientRect();
        const tl = pg.querySelector('.textLayer')!;
        const tlRect = tl.getBoundingClientRect();
        return {
          dataMainRotation: tl.getAttribute('data-main-rotation'),
          transform: getComputedStyle(tl).transform,
          widthDiff: Math.abs(canvas.width - tlRect.width),
          heightDiff: Math.abs(canvas.height - tlRect.height),
          hasEndOfContent: !!tl.querySelector('.endOfContent'),
        };
      }, pageNum);

      expect(box.dataMainRotation).toBe(expectedRotation);
      expect(box.transform).not.toBe('none');
      expect(box.widthDiff).toBeLessThanOrEqual(4);
      expect(box.heightDiff).toBeLessThanOrEqual(4);
      expect(box.hasEndOfContent).toBe(true);
    }

    // 3. Double-click on word selects text without zooming or clearing selection
    await page.evaluate(() => {
      const cvs = document.querySelector('.cvs');
      if (cvs) cvs.scrollTop = 0;
    });
    await page.waitForSelector('.pg-item[data-page="1"] .textLayer span', { timeout: 10000 });
    await page.locator('.pg-item[data-page="1"] .textLayer span').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);

    const zoomBeforeDbl = await page.locator('.zoom-badge').textContent();
    const spanBox = await page.evaluate(() => {
      const span = document.querySelector('.pg-item[data-page="1"] .textLayer span')!;
      return span.getBoundingClientRect().toJSON();
    });
    await page.mouse.dblclick(spanBox.left + 12, spanBox.top + spanBox.height / 2);
    await page.waitForTimeout(200);

    const dblState = await page.evaluate(() => ({
      selText: window.getSelection()?.toString() || '',
      zoomText: document.querySelector('.zoom-badge')?.textContent,
      menuVisible: !!document.querySelector('.viewer-selection-menu'),
    }));
    expect(dblState.selText.trim().length).toBeGreaterThan(0);
    expect(dblState.zoomText).toBe(zoomBeforeDbl);
    expect(dblState.menuVisible).toBe(true);

    // 4. Copy selected text via selection menu
    await page.locator('.viewer-selection-menu button', { hasText: 'Copy' }).click();
    await page.waitForTimeout(150);
    const clipText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipText).toContain('FirstPage');

    // 5. Scroll far down to page 5 while selection is active on page 1 -> page 1 selection survives
    await page.locator('.pg-item[data-page="5"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const afterScrollSel = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(afterScrollSel.trim().length).toBeGreaterThan(0);

    // 6. Select All on Page keeps scroll position stationary and anchors menu inside viewport
    const scrollBeforeSelectAll = await page.evaluate(() => {
      const cvs = document.querySelector('.cvs')!;
      cvs.scrollTop = 450;
      return cvs.scrollTop;
    });
    await page.waitForTimeout(150);
    await page.locator('.viewer-selection-menu button', { hasText: 'Select All on Page' }).click();
    await page.waitForTimeout(200);

    const selectAllCheck = await page.evaluate(() => {
      const cvs = document.querySelector('.cvs')!;
      const menu = document.querySelector('.viewer-selection-menu');
      const vtb = document.querySelector('.vtb');
      const menuRect = menu?.getBoundingClientRect();
      const vtbBottom = vtb ? vtb.getBoundingClientRect().bottom : 0;
      return {
        scrollAfter: cvs.scrollTop,
        selLen: (window.getSelection()?.toString() || '').length,
        origin: menu?.getAttribute('data-selection-origin'),
        menuTop: menuRect?.top ?? -1,
        menuBottom: menuRect?.bottom ?? 99999,
        vtbBottom,
        vh: window.innerHeight,
      };
    });
    expect(selectAllCheck.selLen).toBeGreaterThan(0);
    expect(selectAllCheck.scrollAfter).toBe(scrollBeforeSelectAll);
    expect(selectAllCheck.origin).toBe('select-all');
    expect(selectAllCheck.menuTop).toBeGreaterThanOrEqual(selectAllCheck.vtbBottom);
    expect(selectAllCheck.menuBottom).toBeLessThanOrEqual(selectAllCheck.vh);

    // 6b. Zooming while Select All on Page is active must preserve selection AND keep origin='select-all'
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(350);
    const afterZoomSelectAll = await page.evaluate(() => {
      const menu = document.querySelector('.viewer-selection-menu');
      const r = menu?.getBoundingClientRect();
      return {
        selText: window.getSelection()?.toString() || '',
        origin: menu?.getAttribute('data-selection-origin'),
        menuTop: r?.top ?? -1,
        menuBottom: r?.bottom ?? 99999,
        vh: window.innerHeight,
      };
    });
    expect(afterZoomSelectAll.selText).toContain('FirstPage');
    expect(afterZoomSelectAll.origin).toBe('select-all');
    expect(afterZoomSelectAll.menuTop).toBeGreaterThanOrEqual(0);
    expect(afterZoomSelectAll.menuBottom).toBeLessThanOrEqual(afterZoomSelectAll.vh);

    // 6c. Cross-page selection (page 1 -> page 2) survives zooming
    await page.evaluate(() => {
      const cvs = document.querySelector('.cvs');
      if (cvs) cvs.scrollTop = 0;
    });
    await page.locator('.pg-item[data-page="2"]').scrollIntoViewIfNeeded();
    await page.waitForSelector('.pg-item[data-page="2"] .textLayer span', { timeout: 10000 });
    await page.waitForSelector('.pg-item[data-page="1"] .textLayer span', { timeout: 10000 });
    await page.evaluate(() => {
      const p1Span = document.querySelector('.pg-item[data-page="1"] .textLayer span:not(.markedContent)')!;
      const p2Spans = document.querySelectorAll('.pg-item[data-page="2"] .textLayer span:not(.markedContent)');
      const p2Span = p2Spans[p2Spans.length - 1]!;
      const range = document.createRange();
      range.setStart(p1Span.firstChild || p1Span, 0);
      range.setEnd(p2Span.firstChild || p2Span, (p2Span.textContent || '').length);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await page.waitForTimeout(150);
    const crossPageBeforeZoom = await page.evaluate(() => ({
      text: window.getSelection()?.toString() || '',
      p2SpanCount: document.querySelectorAll('.pg-item[data-page="2"] .textLayer span:not(.markedContent)').length,
    }));
    expect(crossPageBeforeZoom.text).toContain('FirstPage');
    expect(crossPageBeforeZoom.text).toContain('RotatedNinety');
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.waitForTimeout(350);
    const crossPageSel = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(crossPageSel).toContain('FirstPage');
    expect(crossPageSel).toContain('RotatedNinety');

    // 6d. Active search highlights (<mark>) + zoom preserve cross-page selection
    await page.keyboard.press('Control+f');
    const searchInput = page.locator('.viewer-search-bar input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Alpha');
    await page.waitForSelector('.pg-item[data-page="1"] mark.search-highlight', { timeout: 5000 });

    await page.evaluate(() => {
      const p1Span = document.querySelector('.pg-item[data-page="1"] .textLayer span:not(.markedContent)')!;
      const p2Spans = document.querySelectorAll('.pg-item[data-page="2"] .textLayer span:not(.markedContent)');
      const p2Span = p2Spans[p2Spans.length - 1]!;
      const range = document.createRange();
      range.setStart(p1Span.firstChild || p1Span, 0);
      range.setEnd(p2Span.firstChild || p2Span, (p2Span.textContent || '').length);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(350);
    const crossPageWithSearch = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(crossPageWithSearch).toContain('FirstPage');
    expect(crossPageWithSearch).toContain('Alpha');
    expect(crossPageWithSearch).toContain('RotatedNinety');
    await page.locator('.viewer-search-bar button[aria-label="Close search"]').click();

    // Re-trigger Select All on Page 1 before resize test so menu visibility is checked at narrow width
    await page.locator('.pg-item[data-page="1"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.locator('.viewer-selection-menu button', { hasText: 'Select All on Page' }).click();
    await page.waitForTimeout(200);

    // Resize keeps selection and menu inside narrow viewport (375px)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(250);
    const menuBounds = await page.evaluate(() => {
      const m = document.querySelector('.viewer-selection-menu');
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        vw: window.innerWidth,
        vh: window.innerHeight,
        selLen: (window.getSelection()?.toString() || '').length,
      };
    });
    if (menuBounds) {
      expect(menuBounds.selLen).toBeGreaterThan(0);
      expect(menuBounds.left).toBeGreaterThanOrEqual(8);
      expect(menuBounds.right).toBeLessThanOrEqual(menuBounds.vw);
      expect(menuBounds.top).toBeGreaterThanOrEqual(0);
      expect(menuBounds.bottom).toBeLessThanOrEqual(menuBounds.vh);
    }

    // 7. Android delegates text selection menu to native WebView ActionMode (no duplicate React menu)
    // and keeps Ctrl+A / DOM selection scoped strictly to PDF document pages.
    await page.goto('/viewer?platform=android');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'android-viewer.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    });
    await page.waitForSelector('.pg-item[data-page="1"] .textLayer span', { timeout: 15000 });
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await expect(page.locator('.viewer-selection-menu')).toHaveCount(0);
    const androidSelection = await page.evaluate(() => {
      const sel = window.getSelection();
      const anchorEl =
        sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement ?? null;
      const focusEl =
        sel?.focusNode instanceof Element ? sel.focusNode : sel?.focusNode?.parentElement ?? null;
      return {
        text: sel?.toString() || '',
        anchorInsidePdf: Boolean(anchorEl?.closest('.pg-item')),
        focusInsidePdf: Boolean(focusEl?.closest('.pg-item')),
      };
    });
    expect(androidSelection.text).toContain('FirstPage');
    expect(androidSelection.text).not.toContain('InTab');
    expect(androidSelection.anchorInsidePdf).toBe(true);
    expect(androidSelection.focusInsidePdf).toBe(true);
  });

  test('enforces PDF PermissionFlag.COPY restriction and resets state cleanly when switching to an unrestricted PDF', async ({ page }) => {
    const plainBytes = await buildTestPdfBytes();
    const restrictedBytes = await protectPdf(plainBytes, {
      password: 'view-only-pass',
      allowCopying: false,
      allowPrinting: true,
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/viewer?platform=electron');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'copy-restricted.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(restrictedBytes),
    });

    // Enter password in viewer prompt
    const pwdInput = page.locator('input[type="password"]').first();
    await expect(pwdInput).toBeVisible({ timeout: 10000 });
    await pwdInput.fill('view-only-pass');
    await page.locator('button.cta:has-text("Open PDF"), button[type="submit"]').first().click();

    await page.waitForSelector('.pg-item[data-page="1"] .textLayer.copy-restricted', { timeout: 15000 });
    await expect(page.locator('.viewer-permission-banner')).toContainText('Copying text is disabled');

    // Ctrl+A must NOT select restricted text and selection menu must remain absent
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window.getSelection()?.toString() || '').trim())).toBe('');
    await expect(page.locator('.viewer-selection-menu')).toHaveCount(0);

    // Switch back to unrestricted PDF -> restrictions reset completely (no stale permission state)
    await page.getByRole('button', { name: 'Close PDF' }).click();
    await page.goto('/viewer?platform=electron');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'plain-open.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(plainBytes),
    });
    await page.waitForSelector('.pg-item[data-page="1"] .textLayer span', { timeout: 15000 });
    await expect(page.locator('.viewer-permission-banner')).toHaveCount(0);
    await expect(page.locator('.pg-item[data-page="1"] .textLayer.copy-restricted')).toHaveCount(0);

    await page.keyboard.press('Control+a');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.getSelection()?.toString() || '')).toContain('FirstPage');
  });
});
