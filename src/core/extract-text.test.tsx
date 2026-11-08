import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import {
  extractTextFromPdf,
  formatPageTextContent,
} from './extract-text';
import ExtractTextTool from '../tools/modules/ExtractTextTool';
import ToolResultCard from '../pages/tool/ToolResultCard';
import { getToolById } from '../tools/registry';
import type { StagedFile } from '../tools/types';

async function createMultiLinePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([400, 600]);
  page1.drawText('InTabPDF Text Extraction', { x: 50, y: 550, size: 14 });
  page1.drawText('This is line two of the first paragraph.', { x: 50, y: 530, size: 12 });
  page1.drawText('This is a new paragraph.', { x: 50, y: 480, size: 12 });

  const page2 = doc.addPage([400, 600]);
  page2.drawText('Second page content.', { x: 50, y: 550, size: 12 });
  return await doc.save();
}

describe('Extract Text Core & Component Suite', () => {
  describe('formatPageTextContent', () => {
    it('returns empty string for empty items', () => {
      expect(formatPageTextContent([])).toBe('');
      expect(formatPageTextContent([null, undefined, {}])).toBe('');
    });

    it('joins items on the same horizontal baseline with spacing when separated by gap', () => {
      const items = [
        { str: 'Hello', transform: [12, 0, 0, 12, 50, 500], width: 30 },
        { str: 'World', transform: [12, 0, 0, 12, 85, 500], width: 30 },
      ];
      expect(formatPageTextContent(items)).toBe('Hello World');
    });

    it('preserves line breaks when keepLineBreaks is true', () => {
      const items = [
        { str: 'Line 1', transform: [12, 0, 0, 12, 50, 500], width: 40 },
        { str: 'Line 2', transform: [12, 0, 0, 12, 50, 485], width: 40 },
      ];
      const result = formatPageTextContent(items, true);
      expect(result).toBe('Line 1\nLine 2');
    });

    it('joins lines into a single sentence when keepLineBreaks is false', () => {
      const items = [
        { str: 'Line 1', transform: [12, 0, 0, 12, 50, 500], width: 40 },
        { str: 'Line 2', transform: [12, 0, 0, 12, 50, 485], width: 40 },
      ];
      const result = formatPageTextContent(items, false);
      expect(result).toBe('Line 1 Line 2');
    });

    it('preserves paragraph double-breaks even when keepLineBreaks is false', () => {
      const items = [
        { str: 'Para 1', transform: [12, 0, 0, 12, 50, 500], width: 40 },
        { str: 'Para 2', transform: [12, 0, 0, 12, 50, 450], width: 40 }, // deltaY 50 > 12 * 1.6
      ];
      const result = formatPageTextContent(items, false);
      expect(result).toBe('Para 1\n\nPara 2');
    });
  });

  describe('extractTextFromPdf', () => {
    it('extracts text accurately across multiple pages and calculates word/char counts', async () => {
      const pdfBytes = await createMultiLinePdf();
      const result = await extractTextFromPdf(pdfBytes, { keepLineBreaks: true });

      expect(result.pageCount).toBe(2);
      expect(result.text).toContain('InTabPDF Text Extraction');
      expect(result.text).toContain('This is line two');
      expect(result.text).toContain('Second page content.');
      expect(result.wordCount).toBeGreaterThan(10);
      expect(result.charCount).toBeGreaterThan(50);
    });

    it('joins lines into continuous paragraphs when keepLineBreaks is false', async () => {
      const pdfBytes = await createMultiLinePdf();
      const result = await extractTextFromPdf(pdfBytes, { keepLineBreaks: false });

      expect(result.text).toContain('InTabPDF Text Extraction This is line two of the first paragraph.');
    });

    it('throws error when empty buffer is passed', async () => {
      await expect(extractTextFromPdf(new Uint8Array(0))).rejects.toThrow(
        'No PDF file provided for text extraction.'
      );
    });
  });

  describe('ExtractTextTool UI Component', () => {
    const extractDef = getToolById('extract-text')!;

    it('renders Keep line breaks switch and action button', () => {
      const dummyFile: StagedFile = {
        id: 'test-1',
        name: 'sample.pdf',
        size: 1024,
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      };

      const html = renderToString(
        <ExtractTextTool
          tool={extractDef}
          stagedFiles={[dummyFile]}
          optionsState={{ 'line-breaks': true }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
          outputBaseName="extracted-text"
          onOutputBaseNameChange={() => {}}
          defaultBaseName="extracted-text"
          outputExtension=".txt"
        />
      );

      expect(html).toContain('Keep line breaks');
      expect(html).toContain('Off joins lines into paragraphs');
      expect(html).toContain('placeholder="extracted-text"');
      expect(html).toContain('.txt');
      expect(html).toContain('Extract text from file');
    });
  });

  describe('ToolResultCard for Text Output', () => {
    const extractDef = getToolById('extract-text')!;
    const dummyFile: StagedFile = {
      id: 'test-1',
      name: 'notes.pdf',
      size: 5000,
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    };
    const sampleText = 'This is the extracted text content from InTabPDF.';
    const textBytes = new TextEncoder().encode(sampleText);

    it('displays word count, character count, preview textarea, and Save TXT button', () => {
      const html = renderToString(
        <ToolResultCard
          tool={extractDef}
          stagedFiles={[dummyFile]}
          outputBytes={textBytes}
          extraState={{}}
          customFileName="extracted-notes"
          onCustomFileNameChange={() => {}}
          defaultBaseName="extracted-notes"
          outputExtension=".txt"
          isSaved={false}
          isZipOutput={false}
          platformType="web"
          onDownload={() => {}}
          onViewPdf={() => {}}
          onStartOver={() => {}}
        />
      );

      expect(html).toContain('8');
      expect(html).toContain('words');
      expect(html).toContain('49');
      expect(html).toContain('characters');
      expect(html).toContain('Copy text');
      expect(html).toContain('This is the extracted text content from InTabPDF.');
      expect(html).toContain('Save TXT');
      // Must not show PDF viewer button for text file
      expect(html).not.toContain('View on Web');
      expect(html).not.toContain('Open in Viewer');
    });
  });
});
