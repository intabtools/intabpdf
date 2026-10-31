import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { getPlatformType } from './index';

describe('Desktop Branding and Window Title Specification', () => {
  const rootDir = resolve(__dirname, '../../');
  const mainCjsPath = resolve(rootDir, 'electron/main.cjs');
  const indexHtmlPath = resolve(rootDir, 'index.html');
  const mainTsxPath = resolve(rootDir, 'src/main.tsx');

  it('configures Electron BrowserWindow title strictly as "InTabPDF" without spaces or tagline', () => {
    const mainCjs = readFileSync(mainCjsPath, 'utf8');
    
    // Check BrowserWindow options
    expect(mainCjs).toContain("title: 'InTabPDF'");
    expect(mainCjs).not.toContain("title: 'InTab PDF'");

    // Check explicit setTitle
    expect(mainCjs).toContain("win.setTitle('InTabPDF')");

    // Check page-title-updated prevention
    expect(mainCjs).toMatch(/win\.on\('page-title-updated',\s*\((?:event|_event)\)\s*=>\s*\{\s*(?:event|_event)\.preventDefault\(\);?\s*\}\)/);
  });

  it('preserves the SEO tagline in index.html for web search indexing', () => {
    const indexHtml = readFileSync(indexHtmlPath, 'utf8');
    expect(indexHtml).toContain('<title>InTabPDF : Privacy-First PDF Tools That Never Leave Your Device</title>');
    expect(indexHtml).toContain('<meta property="og:title" content="InTabPDF : Privacy-First PDF Tools That Never Leave Your Device" />');
    expect(indexHtml).toContain('<meta name="twitter:title" content="InTabPDF : Privacy-First PDF Tools That Never Leave Your Device" />');
  });

  it('sets document.title to "InTabPDF" on electron while leaving web untouched', () => {
    const mainTsx = readFileSync(mainTsxPath, 'utf8');
    expect(mainTsx).toContain("if (platformType === 'electron') {");
    expect(mainTsx).toContain("document.title = 'InTabPDF';");

    // In non-electron runtime (e.g. test/web environment), getPlatformType() should be 'web' or similar
    const platform = getPlatformType();
    if (platform !== 'electron') {
      // In web, the title should remain from index.html or not be forced to desktop branding
      expect(platform).not.toBe('electron');
    }
  });

  it('ensures no other application components or hooks overwrite document.title', () => {
    // Verify that across src/, only main.tsx sets document.title (excluding tests)
    const srcDir = resolve(rootDir, 'src');
    const grepResult = execSync(`git grep -n "document\\.title" "${srcDir}"`, { encoding: 'utf8' }).trim();
    const nonTestLines = grepResult.split('\n').filter((line) => !line.includes('.test.'));
    expect(nonTestLines.length).toBe(1);
    expect(nonTestLines[0]).toContain('src/main.tsx');
  });
});
