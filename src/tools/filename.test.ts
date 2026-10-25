import { describe, expect, it } from 'vitest';
import {
  getCleanBaseName,
  getDefaultOutputBaseName,
  getOutputExtension,
  sanitizeOutputFileName,
} from './filename';

describe('Filename generation & sanitization', () => {
  describe('getCleanBaseName', () => {
    it('removes common extensions case-insensitively', () => {
      expect(getCleanBaseName('sample.pdf')).toBe('sample');
      expect(getCleanBaseName('DOCUMENT.PDF')).toBe('DOCUMENT');
      expect(getCleanBaseName('photo.jpg')).toBe('photo');
      expect(getCleanBaseName('image.PNG')).toBe('image');
      expect(getCleanBaseName('scan.webp')).toBe('scan');
      expect(getCleanBaseName('notes.txt')).toBe('notes');
      expect(getCleanBaseName('archive.zip')).toBe('archive');
    });

    it('preserves multi-part names before the extension', () => {
      expect(getCleanBaseName('annual.report.2024.pdf')).toBe('annual.report.2024');
      expect(getCleanBaseName('quarterly-summary_v2.pdf')).toBe('quarterly-summary_v2');
    });

    it('handles names without extension and empty string', () => {
      expect(getCleanBaseName('myfile')).toBe('myfile');
      expect(getCleanBaseName('')).toBe('');
    });
  });

  describe('getDefaultOutputBaseName', () => {
    it('generates correct defaults with staged files', () => {
      const files = [{ name: 'financial-report.pdf' }];

      expect(getDefaultOutputBaseName('merge', files)).toBe('merged-financial-report');
      expect(getDefaultOutputBaseName('rotate', files)).toBe('rotated-financial-report');
      expect(getDefaultOutputBaseName('remove-pages', files)).toBe('edited-financial-report');
      expect(getDefaultOutputBaseName('split', files)).toBe('split-financial-report');
      expect(getDefaultOutputBaseName('compress', files)).toBe('compressed-financial-report');
      expect(getDefaultOutputBaseName('images-to-pdf', [{ name: 'img1.png' }])).toBe('images-to-pdf');
    });

    it('generates correct defaults without staged files', () => {
      expect(getDefaultOutputBaseName('merge', [])).toBe('merged-document');
      expect(getDefaultOutputBaseName('rotate', [])).toBe('rotated-document');
      expect(getDefaultOutputBaseName('remove-pages', [])).toBe('edited-document');
      expect(getDefaultOutputBaseName('split', [])).toBe('split-document');
      expect(getDefaultOutputBaseName('compress', [])).toBe('compressed-document');
      expect(getDefaultOutputBaseName('images-to-pdf', [])).toBe('images-to-pdf');
    });
  });

  describe('getOutputExtension', () => {
    it('returns .zip for split tool or .zip output names', () => {
      expect(getOutputExtension('split', 'split.zip')).toBe('.zip');
      expect(getOutputExtension('split')).toBe('.zip');
      expect(getOutputExtension('other', 'archive.zip')).toBe('.zip');
    });

    it('returns .pdf for standard PDF tools', () => {
      expect(getOutputExtension('merge', 'merged.pdf')).toBe('.pdf');
      expect(getOutputExtension('rotate', 'rotated.pdf')).toBe('.pdf');
      expect(getOutputExtension('remove-pages', 'edited.pdf')).toBe('.pdf');
      expect(getOutputExtension('compress', 'compressed.pdf')).toBe('.pdf');
      expect(getOutputExtension('images-to-pdf', 'images-to-pdf.pdf')).toBe('.pdf');
    });
  });

  describe('sanitizeOutputFileName', () => {
    it('prevents duplicate extensions when user types extension manually', () => {
      expect(sanitizeOutputFileName('custom.pdf', 'default', '.pdf')).toBe('custom.pdf');
      expect(sanitizeOutputFileName('CUSTOM.PDF', 'default', '.pdf')).toBe('CUSTOM.pdf');
      expect(sanitizeOutputFileName('archive.zip', 'default', '.zip')).toBe('archive.zip');
      expect(sanitizeOutputFileName('archive.ZIP', 'default', '.zip')).toBe('archive.zip');
    });

    it('strips illegal filesystem characters across Windows, Mac, Linux, and Android', () => {
      expect(sanitizeOutputFileName('test/file:name*with?illegal"chars<here>|now', 'default', '.pdf'))
        .toBe('test-file-name-with-illegal-chars-here-now.pdf');
      expect(sanitizeOutputFileName('c:\\windows\\system32', 'default', '.pdf'))
        .toBe('c-windows-system32.pdf');
    });

    it('collapses multiple dashes and strips leading/trailing dashes/dots', () => {
      expect(sanitizeOutputFileName('--my---clean--name--', 'default', '.pdf'))
        .toBe('my-clean-name.pdf');
      expect(sanitizeOutputFileName('...my.file...', 'default', '.pdf'))
        .toBe('my.file.pdf');
    });

    it('handles Windows reserved device names safely', () => {
      expect(sanitizeOutputFileName('con', 'default', '.pdf')).toBe('con-file.pdf');
      expect(sanitizeOutputFileName('PRN', 'default', '.pdf')).toBe('PRN-file.pdf');
      expect(sanitizeOutputFileName('aux', 'default', '.pdf')).toBe('aux-file.pdf');
      expect(sanitizeOutputFileName('nul', 'default', '.pdf')).toBe('nul-file.pdf');
      expect(sanitizeOutputFileName('com1', 'default', '.pdf')).toBe('com1-file.pdf');
      expect(sanitizeOutputFileName('lpt9', 'default', '.pdf')).toBe('lpt9-file.pdf');
    });

    it('falls back to defaultBaseName if input becomes empty or consists only of spaces/illegal chars', () => {
      expect(sanitizeOutputFileName('', 'default-document', '.pdf')).toBe('default-document.pdf');
      expect(sanitizeOutputFileName('   ', 'fallback', '.pdf')).toBe('fallback.pdf');
      expect(sanitizeOutputFileName('///:::***', 'fallback', '.pdf')).toBe('fallback.pdf');
      expect(sanitizeOutputFileName('.pdf', 'fallback', '.pdf')).toBe('fallback.pdf');
    });

    it('locks output extension to the target format', () => {
      expect(sanitizeOutputFileName('my-split-archive', 'split-doc', '.zip')).toBe('my-split-archive.zip');
      expect(sanitizeOutputFileName('my-split-archive.pdf', 'split-doc', '.zip')).toBe('my-split-archive.zip');
    });
  });
});
