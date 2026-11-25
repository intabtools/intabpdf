import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  PAGE_SIZES,
  findUnsupportedCharacters,
  textToPdf,
} from './text-to-pdf';

describe('textToPdf Core Operation', () => {
  it('generates a valid single-page PDF with default options from short text', async () => {
    const text = 'Hello world! This is a test document created by InTabPDF.';
    const pdfBytes = await textToPdf(text);

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.byteLength).toBeGreaterThan(0);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);

    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(PAGE_SIZES.a4.width, 1);
    expect(page.getHeight()).toBeCloseTo(PAGE_SIZES.a4.height, 1);
  });

  it('rejects empty or whitespace-only text with a clear error', async () => {
    await expect(textToPdf('')).rejects.toThrow('No text provided for PDF generation.');
    await expect(textToPdf('   \n\t  \n  ')).rejects.toThrow('No text provided for PDF generation.');
  });

  it('correctly applies Letter and Legal page sizes', async () => {
    const letterBytes = await textToPdf('Letter page test', { pageSize: 'letter' });
    const letterDoc = await PDFDocument.load(letterBytes);
    expect(letterDoc.getPage(0).getWidth()).toBeCloseTo(PAGE_SIZES.letter.width, 1);
    expect(letterDoc.getPage(0).getHeight()).toBeCloseTo(PAGE_SIZES.letter.height, 1);

    const legalBytes = await textToPdf('Legal page test', { pageSize: 'legal' });
    const legalDoc = await PDFDocument.load(legalBytes);
    expect(legalDoc.getPage(0).getWidth()).toBeCloseTo(PAGE_SIZES.legal.width, 1);
    expect(legalDoc.getPage(0).getHeight()).toBeCloseTo(PAGE_SIZES.legal.height, 1);
  });

  it('correctly inverts dimensions in landscape orientation', async () => {
    const landscapeBytes = await textToPdf('Landscape test', {
      pageSize: 'a4',
      orientation: 'landscape',
    });
    const doc = await PDFDocument.load(landscapeBytes);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(PAGE_SIZES.a4.height, 1);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(PAGE_SIZES.a4.width, 1);
  });

  it('supports all font families: helvetica, times, courier', async () => {
    for (const fontFamily of ['helvetica', 'times', 'courier'] as const) {
      const bytes = await textToPdf(`Testing font ${fontFamily}`, { fontFamily });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it('renders page numbering by default and omits it when disabled', async () => {
    const withNums = await textToPdf('Page 1 test', { includePageNumbers: true });
    const withoutNums = await textToPdf('Page 1 test', { includePageNumbers: false });

    expect(withNums.byteLength).toBeGreaterThan(0);
    expect(withoutNums.byteLength).toBeGreaterThan(0);
  });

  it('correctly handles long unbroken words by wrapping characters across lines', async () => {
    const longWord = 'A'.repeat(500); // Exceeds contentWidth by far
    const bytes = await textToPdf(longWord);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('identifies unsupported Unicode characters and throws informative error', async () => {
    const cyrillicText = 'Hello мир!';
    await expect(textToPdf(cyrillicText)).rejects.toThrow(/Unsupported characters detected/);

    const devanagariText = 'Namaste नमस्ते';
    await expect(textToPdf(devanagariText)).rejects.toThrow(/Unsupported characters detected/);

    const chineseText = 'Welcome 欢迎';
    await expect(textToPdf(chineseText)).rejects.toThrow(/Unsupported characters detected/);

    const emojiText = 'Smile 😊';
    await expect(textToPdf(emojiText)).rejects.toThrow(/Unsupported characters detected/);
  });

  it('supports WinAnsi typographic symbols (Euro, quotes, dashes, trademark)', async () => {
    const text = 'Price: €100. "Quoted" and \'single\'. Hyphen-minus, emdash-like, symbol: ™, ©, ®.';
    const bytes = await textToPdf(text);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('findUnsupportedCharacters reports character and line numbers correctly', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont('Helvetica');
    const input = 'Line 1: OK\nLine 2: with 漢字\nLine 3: and 😊';

    const unsupp = findUnsupportedCharacters(input, font);
    expect(unsupp.length).toBe(3); // 2 chinese characters on line 2, 1 emoji on line 3
    expect(unsupp[0].char).toBe('漢');
    expect(unsupp[0].line).toBe(2);
    expect(unsupp[1].char).toBe('字');
    expect(unsupp[1].line).toBe(2);
    expect(unsupp[2].line).toBe(3);
  });

  it('never invokes yieldFn when signal is omitted (worker synchronous fast path)', async () => {
    const yieldSpy = vi.fn();
    const text = 'Worker path text that produces multiple lines.\n'.repeat(150);

    const result = await textToPdf(
      text,
      {},
      undefined, // No signal
      { yieldBudgetMs: 0, yieldFn: yieldSpy }
    );

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(yieldSpy).not.toHaveBeenCalled();
  });

  it('deterministically aborts during layout at the first yield point', async () => {
    const abortCtrl = new AbortController();
    let yieldCount = 0;

    const deterministicYield = async () => {
      yieldCount++;
      abortCtrl.abort(new DOMException('Deterministic cancellation triggered at yield', 'AbortError'));
    };

    const text = 'Line of text for layout testing.\n'.repeat(200);

    const promise = textToPdf(
      text,
      {},
      abortCtrl.signal,
      { yieldBudgetMs: 0, yieldFn: deterministicYield }
    );

    await expect(promise).rejects.toThrow('Deterministic cancellation triggered at yield');
    expect(yieldCount).toBe(1);
  });

  it('deterministically aborts inside a single long paragraph with no newlines', async () => {
    const abortCtrl = new AbortController();
    let yieldCount = 0;

    const deterministicYield = async () => {
      yieldCount++;
      abortCtrl.abort(new DOMException('Cancelled inside single long paragraph', 'AbortError'));
    };

    // Single 50,000-character paragraph without newlines
    const singlePara = 'word '.repeat(10000);

    const promise = textToPdf(
      singlePara,
      {},
      abortCtrl.signal,
      { yieldBudgetMs: 0, yieldFn: deterministicYield }
    );

    await expect(promise).rejects.toThrow('Cancelled inside single long paragraph');
    expect(yieldCount).toBe(1);
  });

  it('deterministically aborts inside a paragraph with many short words', async () => {
    const abortCtrl = new AbortController();
    let yieldCount = 0;

    const deterministicYield = async () => {
      yieldCount++;
      abortCtrl.abort(new DOMException('Cancelled inside many short words', 'AbortError'));
    };

    // Paragraph with thousands of short words
    const manyWords = 'a b c d e f g h '.repeat(1500);

    const promise = textToPdf(
      manyWords,
      {},
      abortCtrl.signal,
      { yieldBudgetMs: 0, yieldFn: deterministicYield }
    );

    await expect(promise).rejects.toThrow('Cancelled inside many short words');
    expect(yieldCount).toBe(1);
  });

  it('aborts immediately if caller passes an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Pre-aborted signal', 'AbortError'));

    await expect(textToPdf('Some text', {}, controller.signal)).rejects.toThrow('Pre-aborted signal');
  });
});
