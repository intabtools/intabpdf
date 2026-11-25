import { test, expect } from '@playwright/test';

test.describe('Application Startup and Navigation', () => {
  test('renders homepage with expected branding, badges, and tools', async ({ page }) => {
    await page.goto('/');

    // Validate page title
    await expect(page).toHaveTitle(/InTabPDF/i);

    // Validate hero header
    await expect(page.locator('h1')).toContainText('PDF tools that never leave your device');

    // Validate key security/privacy value propositions
    await expect(page.locator('.pills').getByText('No uploads', { exact: true })).toBeVisible();
    await expect(page.locator('.pills').getByText('No account', { exact: true })).toBeVisible();

    // Verify key implemented tools appear on the homepage
    const tools = ['Merge', 'Split', 'Rotate pages', 'Remove pages', 'Compress', 'Images to PDF', 'PDF to images', 'Extract text'];
    for (const toolName of tools) {
      await expect(page.locator(`text=${toolName}`).first()).toBeVisible();
    }
  });

  test('navigates from homepage to a tool page and renders the drop zone', async ({ page }) => {
    await page.goto('/');

    // Click on the Merge tool card
    const mergeCard = page.locator('a[href="/tool/merge"]').first();
    await mergeCard.click();

    await expect(page).toHaveURL(/\/tool\/merge/);
    await expect(page.locator('.dz')).toBeVisible();
    await expect(page.locator('text=Combine several PDFs into one').first()).toBeVisible();
  });

  test('navigates to About page successfully', async ({ page }) => {
    await page.goto('/');

    const aboutLink = page.locator('a[href="/about"]').first();
    await aboutLink.click();

    await expect(page).toHaveURL(/\/about/);
    await expect(page.locator('text=About InTab PDF').or(page.locator('h2:has-text("About InTab PDF")'))).toBeVisible();
  });
});
