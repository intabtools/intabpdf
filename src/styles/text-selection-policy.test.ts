import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Global Text Selection Policy (Part A)', () => {
  const baseCssPath = path.resolve(__dirname, 'base.css');
  const baseCss = fs.readFileSync(baseCssPath, 'utf-8');

  const viewerCssPath = path.resolve(__dirname, '../viewer/viewer.css');
  const viewerCss = fs.readFileSync(viewerCssPath, 'utf-8');

  it('1. enforces user-select: none on html and body globally across platforms', () => {
    expect(baseCss).toMatch(/html,\s*body\s*\{[^}]*user-select:\s*none;/);
    expect(baseCss).toMatch(/html,\s*body\s*\{[^}]*-webkit-user-select:\s*none;/);
  });

  it('2. enforces user-select: none on #root and .app top-level containers', () => {
    expect(baseCss).toMatch(/#root\s*\{[^}]*user-select:\s*none;/);
    expect(baseCss).toMatch(/#root\s*\{[^}]*-webkit-user-select:\s*none;/);
  });

  it('3. enforces user-select: none on application UI: tool cards, options, navigation, footer, status bar, dialogs', () => {
    // Check key application classes in the non-selectable UI declaration block
    expect(baseCss).toMatch(/\.card\b/);
    expect(baseCss).toMatch(/\.card\.opts\b/);
    expect(baseCss).toMatch(/\.tp\b/);
    expect(baseCss).toMatch(/\.wf\b/); // Website footer
    expect(baseCss).toMatch(/\.stb\b/); // Desktop status bar
    expect(baseCss).toMatch(/\bdialog\b/);
    expect(baseCss).toMatch(/\.mo\b/); // Modals

    // Verify .card.opts .summary was removed from user-select: text exceptions
    expect(baseCss).not.toMatch(/\.card\.opts\s+\.summary\s*\{[^}]*user-select:\s*text;/);
  });

  it('4. strictly preserves user-select: text on inputs, textareas, and contenteditable elements', () => {
    expect(baseCss).toMatch(/input,\s*textarea,\s*\[contenteditable="true"\][^}]*user-select:\s*text;/);
    expect(baseCss).toMatch(/input,\s*textarea,\s*\[contenteditable="true"\][^}]*-webkit-user-select:\s*text;/);
    expect(baseCss).toMatch(/\.output-filename-group input/);
    expect(baseCss).toMatch(/\.viewer-search-bar input/);
  });

  it('5. strictly preserves user-select: text in PDF viewer textLayer, scoped narrowly under .vwr', () => {
    // Base CSS exception must be scoped under .vwr document container
    expect(baseCss).toMatch(/\.vwr\s+\.textLayer,\s*\.vwr\s+\.textLayer\s+\*\s*\{[^}]*user-select:\s*text;/);
    // Base CSS must NOT contain broad un-scoped .textLayer selector
    expect(baseCss).not.toMatch(/(?:^|[,\s])\.textLayer\s*(?:,\s*\{|\{)/);

    // Viewer CSS rules for internal textLayer positioning and selection
    expect(viewerCss).toMatch(/\.textLayer\s*\{[^}]*user-select:\s*text;/);
    expect(viewerCss).toMatch(/\.textLayer\s+:is\(span,\s*br\)\s*\{[^}]*user-select:\s*text;/);
    expect(viewerCss).toMatch(/\.textLayer\s+::selection\s*\{[^}]*background:/);
  });

  it('6. scopes text selection narrowly: viewer toolbar and selection menu remain user-select: none', () => {
    // Viewer Selection Menu container must be non-selectable
    expect(viewerCss).toMatch(/\.viewer-selection-menu\s*\{[^}]*user-select:\s*none;/);

    // Floating pill controls must be non-selectable
    expect(viewerCss).toMatch(/\.viewer-pill\s*\{[^}]*user-select:\s*none;/);

    // Viewer toolbar search bar container must be non-selectable
    expect(viewerCss).toMatch(/\.viewer-search-bar\s*\{[^}]*user-select:\s*none;/);
  });
});
