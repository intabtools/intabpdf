// Pure core operation for converting plain text into a valid PDF document.
// Zero DOM or browser dependencies: accepts text and returns transformed byte array (Uint8Array).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';

export type TextPageSize = 'a4' | 'letter' | 'legal';
export type TextOrientation = 'portrait' | 'landscape';
export type TextMarginPreset = 'compact' | 'normal' | 'spacious';
export type TextFontFamily = 'helvetica' | 'times' | 'courier';

export interface TextToPdfOptions {
  pageSize?: TextPageSize;
  orientation?: TextOrientation;
  marginPreset?: TextMarginPreset;
  fontFamily?: TextFontFamily;
  fontSize?: number;
  lineSpacing?: number;
  includePageNumbers?: boolean;
}

export interface TextToPdfTestHooks {
  yieldBudgetMs?: number;
  yieldFn?: () => Promise<void>;
}

export interface UnsupportedCharacterInfo {
  char: string;
  line: number;
}

// Standard page dimensions in PDF points (72 points per inch)
export const PAGE_SIZES: Record<TextPageSize, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612.0, height: 792.0 },
  legal: { width: 612.0, height: 1008.0 },
};

export const MARGIN_PRESETS: Record<TextMarginPreset, number> = {
  compact: 36, // 0.50 inch
  normal: 54, // 0.75 inch
  spacious: 72, // 1.00 inch
};

export const FOOTER_RESERVE_POINTS = 28;

const FONT_MAP: Record<TextFontFamily, StandardFonts> = {
  helvetica: StandardFonts.Helvetica,
  times: StandardFonts.TimesRoman,
  courier: StandardFonts.Courier,
};

/**
 * Validates whether the text contains characters unencodable by the standard font.
 * Uses the official font.getCharacterSet() public API from pdf-lib.
 */
export function findUnsupportedCharacters(text: string, font: PDFFont): UnsupportedCharacterInfo[] {
  const supported = new Set(font.getCharacterSet());
  const unsupported: UnsupportedCharacterInfo[] = [];
  const lines = text.split(/\r\n|\r|\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    for (const char of lineText) {
      const cp = char.codePointAt(0);
      if (cp !== undefined && !supported.has(cp)) {
        unsupported.push({ char, line: lineIdx + 1 });
      }
    }
  }
  return unsupported;
}

/**
 * Converts plain text into a PDF document with incremental layout and cooperative cancellation.
 */
export async function textToPdf(
  text: string,
  options: TextToPdfOptions = {},
  signal?: AbortSignal,
  testHooks?: TextToPdfTestHooks
): Promise<Uint8Array> {
  // Pre-flight cancellation check
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  // Pre-flight empty / whitespace check
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided for PDF generation.');
  }

  const {
    pageSize = 'a4',
    orientation = 'portrait',
    marginPreset = 'normal',
    fontFamily = 'helvetica',
    fontSize = 11,
    lineSpacing = 1.3,
    includePageNumbers = true,
  } = options;

  const yieldBudgetMs = testHooks?.yieldBudgetMs ?? 12;
  const yieldFn = testHooks?.yieldFn ?? (() => new Promise<void>((r) => setTimeout(r, 0)));

  let lastYield = performance.now();

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(FONT_MAP[fontFamily]);

  // Validate characters using standard font character set
  const unsupported = findUnsupportedCharacters(text, font);
  if (unsupported.length > 0) {
    const sample = Array.from(new Set(unsupported.map((u) => u.char))).slice(0, 8).join(', ');
    throw new Error(
      `Unsupported characters detected for standard font: [ ${sample} ]. Please use supported Western European characters.`
    );
  }

  // Page geometry
  const baseDim = PAGE_SIZES[pageSize] || PAGE_SIZES.a4;
  const [pageWidth, pageHeight] =
    orientation === 'landscape'
      ? [baseDim.height, baseDim.width]
      : [baseDim.width, baseDim.height];

  const margin = MARGIN_PRESETS[marginPreset] ?? MARGIN_PRESETS.normal;
  const marginLeft = margin;
  const marginRight = margin;
  const marginTop = margin;
  const marginBottom = margin;

  const footerReserve = includePageNumbers ? FOOTER_RESERVE_POINTS : 0;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const bottomLimit = marginBottom + footerReserve;

  const lineHeight = fontSize * lineSpacing;
  const startY = pageHeight - marginTop - fontSize;

  let page = doc.addPage([pageWidth, pageHeight]);
  let cursorY = startY;

  // Track if we need a new page
  const ensurePageSpace = async () => {
    if (cursorY < bottomLimit) {
      page = doc.addPage([pageWidth, pageHeight]);
      cursorY = startY;
      if (signal) {
        if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
        if (performance.now() - lastYield >= yieldBudgetMs) {
          await yieldFn();
          lastYield = performance.now();
          if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
        }
      }
    }
  };

  const flushLine = async (lineText: string) => {
    await ensurePageSpace();
    page.drawText(lineText, {
      x: marginLeft,
      y: cursorY,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= lineHeight;
  };

  // Incremental paragraph and word scanning
  // Normalize \r\n and \r to \n, and expand tabs to 4 spaces
  const normalizedText = text.replace(/\r\n|\r/g, '\n').replace(/\t/g, '    ');
  let paraStart = 0;
  const textLen = normalizedText.length;
  let wordCount = 0;
  let chunkCount = 0;

  while (paraStart < textLen) {
    if (signal) {
      if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
      if (performance.now() - lastYield >= yieldBudgetMs) {
        await yieldFn();
        lastYield = performance.now();
        if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
      }
    }

    let nextNewline = normalizedText.indexOf('\n', paraStart);
    if (nextNewline === -1) {
      nextNewline = textLen;
    }

    const paragraph = normalizedText.slice(paraStart, nextNewline);
    paraStart = nextNewline + 1;

    // Blank line handling: advance cursor if not at very top of page
    if (paragraph.trim().length === 0) {
      if (cursorY < startY) {
        cursorY -= lineHeight;
        await ensurePageSpace();
      }
      continue;
    }

    // Word scan using stateful regular expression
    const WORD_REGEX = /\S+/g;
    let match: RegExpExecArray | null;
    let currentLine = '';

    while ((match = WORD_REGEX.exec(paragraph)) !== null) {
      const word = match[0];
      wordCount++;

      // Periodic yield check inside long paragraphs
      if (signal && (wordCount & 63) === 0) {
        if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
        if (performance.now() - lastYield >= yieldBudgetMs) {
          await yieldFn();
          lastYield = performance.now();
          if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
        }
      }

      const candidateLine = currentLine ? `${currentLine} ${word}` : word;
      const candidateWidth = font.widthOfTextAtSize(candidateLine, fontSize);

      if (candidateWidth <= contentWidth) {
        currentLine = candidateLine;
      } else {
        // Line does not fit candidate. If currentLine has content, flush it.
        if (currentLine) {
          await flushLine(currentLine);
          currentLine = '';
        }

        // Check if the single word alone fits on a line
        const wordWidth = font.widthOfTextAtSize(word, fontSize);
        if (wordWidth <= contentWidth) {
          currentLine = word;
        } else {
          // Word exceeds contentWidth: break character by character
          for (let c = 0; c < word.length; c++) {
            chunkCount++;
            if (signal && (chunkCount & 63) === 0) {
              if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
              if (performance.now() - lastYield >= yieldBudgetMs) {
                await yieldFn();
                lastYield = performance.now();
                if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
              }
            }

            const testChunk = currentLine + word[c];
            if (font.widthOfTextAtSize(testChunk, fontSize) <= contentWidth) {
              currentLine = testChunk;
            } else {
              if (currentLine) {
                await flushLine(currentLine);
              }
              currentLine = word[c];
            }
          }
        }
      }
    }

    // Flush any remainder of the paragraph
    if (currentLine) {
      await flushLine(currentLine);
    }
  }

  // Draw page numbering if requested
  if (includePageNumbers) {
    const pages = doc.getPages();
    const totalPages = pages.length;
    const footerFontSize = 9;
    const footerFont = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 0; i < totalPages; i++) {
      if (signal) {
        if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
        if (performance.now() - lastYield >= yieldBudgetMs) {
          await yieldFn();
          lastYield = performance.now();
          if (signal.aborted) throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
        }
      }

      const p = pages[i];
      const { width: pW } = p.getSize();
      const pageLabel = `Page ${i + 1} of ${totalPages}`;
      const labelWidth = footerFont.widthOfTextAtSize(pageLabel, footerFontSize);
      const labelX = (pW - labelWidth) / 2;
      const labelY = Math.max(marginBottom / 2, 8);

      p.drawText(pageLabel, {
        x: labelX,
        y: labelY,
        size: footerFontSize,
        font: footerFont,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  }

  // Serialization cancellation boundary: last opportunity to cancel cooperatively
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  return await doc.save();
}
