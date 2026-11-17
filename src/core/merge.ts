// Pure core operation for merging multiple PDF documents into a single document.
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRef,
  PDFObject,
  PDFNumber,
  StandardFonts,
  rgb,
  degrees,
} from 'pdf-lib';

export interface MergeOptions {
  /**
   * If true, outline bookmarks from source documents will be retained and chained in the merged document.
   * Defaults to true.
   */
  keepBookmarks?: boolean;

  /**
   * If true, adds bottom-center page numbers ("X / Y") on every page.
   * Defaults to false.
   */
  addPageNumbers?: boolean;
}

/**
 * Copies and chains outline bookmarks from source documents into the target merged document.
 */
function transferBookmarks(
  mergedDoc: PDFDocument,
  sourceDocs: { doc: PDFDocument; pageOffset: number; pageCount: number }[]
): void {
  const mergedOutlinesDict = mergedDoc.context.obj({ Type: 'Outlines' });
  const mergedOutlinesRef = mergedDoc.context.register(mergedOutlinesDict);
  mergedDoc.catalog.set(PDFName.of('Outlines'), mergedOutlinesRef);

  let rootFirstRef: PDFRef | null = null;
  let rootPrevRef: PDFRef | null = null;
  let rootCount = 0;

  for (const { doc: srcDoc, pageOffset } of sourceDocs) {
    const outlinesRef = srcDoc.catalog.get(PDFName.of('Outlines'));
    if (!outlinesRef) continue;

    const outlinesDict = srcDoc.context.lookup(outlinesRef);
    if (!(outlinesDict instanceof PDFDict)) continue;

    const srcPageMap = new Map<string, number>();
    srcDoc.getPages().forEach((p, idx) => {
      srcPageMap.set(p.ref.toString(), idx);
    });

    function copyItem(itemRef: PDFRef, parentRef: PDFRef): PDFRef | null {
      const item = srcDoc.context.lookup(itemRef);
      if (!(item instanceof PDFDict)) return null;

      const title = item.get(PDFName.of('Title'));
      if (!title) return null;

      let targetPageRef: PDFRef | null = null;
      const dest = item.get(PDFName.of('Dest'));
      if (dest instanceof PDFArray && dest.size() > 0) {
        const origRef = dest.get(0);
        if (origRef instanceof PDFRef) {
          const origIdx = srcPageMap.get(origRef.toString());
          if (origIdx !== undefined && pageOffset + origIdx < mergedDoc.getPageCount()) {
            targetPageRef = mergedDoc.getPage(pageOffset + origIdx).ref;
          }
        }
      } else {
        const action = item.get(PDFName.of('A'));
        if (action instanceof PDFDict) {
          const actionDest = action.get(PDFName.of('D'));
          if (actionDest instanceof PDFArray && actionDest.size() > 0) {
            const origRef = actionDest.get(0);
            if (origRef instanceof PDFRef) {
              const origIdx = srcPageMap.get(origRef.toString());
              if (origIdx !== undefined && pageOffset + origIdx < mergedDoc.getPageCount()) {
                targetPageRef = mergedDoc.getPage(pageOffset + origIdx).ref;
              }
            }
          }
        }
      }

      const newItemDict = mergedDoc.context.obj({
        Title: title,
        Parent: parentRef,
      });

      if (targetPageRef) {
        newItemDict.set(
          PDFName.of('Dest'),
          mergedDoc.context.obj([targetPageRef, PDFName.of('Fit')])
        );
      }

      const newItemRef = mergedDoc.context.register(newItemDict);

      // Copy child items if present
      const firstChildRef = item.get(PDFName.of('First'));
      if (firstChildRef instanceof PDFRef) {
        let childRef: PDFRef | null = firstChildRef;
        let firstNewChild: PDFRef | null = null;
        let prevNewChild: PDFRef | null = null;
        let childCount = 0;

        while (childRef) {
          const childItem: PDFObject | undefined = srcDoc.context.lookup(childRef);
          if (!(childItem instanceof PDFDict)) break;

          const newChildRef = copyItem(childRef, newItemRef);
          if (newChildRef) {
            if (!firstNewChild) firstNewChild = newChildRef;
            if (prevNewChild) {
              const prevDict = mergedDoc.context.lookup(prevNewChild);
              if (prevDict instanceof PDFDict) {
                prevDict.set(PDFName.of('Next'), newChildRef);
              }
              const currDict = mergedDoc.context.lookup(newChildRef);
              if (currDict instanceof PDFDict) {
                currDict.set(PDFName.of('Prev'), prevNewChild);
              }
            }
            prevNewChild = newChildRef;
            childCount++;
          }

          const nextChild: PDFObject | undefined = childItem.get(PDFName.of('Next'));
          childRef = nextChild instanceof PDFRef ? nextChild : null;
        }

        if (firstNewChild && prevNewChild) {
          newItemDict.set(PDFName.of('First'), firstNewChild);
          newItemDict.set(PDFName.of('Last'), prevNewChild);
          newItemDict.set(PDFName.of('Count'), PDFNumber.of(childCount));
        }
      }

      return newItemRef;
    };

    const initialFirst = outlinesDict.get(PDFName.of('First'));
    let currentItemRef: PDFRef | null = initialFirst instanceof PDFRef ? initialFirst : null;
    while (currentItemRef) {
      const item = srcDoc.context.lookup(currentItemRef);
      if (!(item instanceof PDFDict)) break;

      const copiedItemRef = copyItem(currentItemRef, mergedOutlinesRef);
      if (copiedItemRef) {
        if (!rootFirstRef) {
          rootFirstRef = copiedItemRef;
        }
        if (rootPrevRef) {
          const prevDict = mergedDoc.context.lookup(rootPrevRef);
          if (prevDict instanceof PDFDict) {
            prevDict.set(PDFName.of('Next'), copiedItemRef);
          }
          const currDict = mergedDoc.context.lookup(copiedItemRef);
          if (currDict instanceof PDFDict) {
            currDict.set(PDFName.of('Prev'), rootPrevRef);
          }
        }
        rootPrevRef = copiedItemRef;
        rootCount++;
      }

      const nextItem = item.get(PDFName.of('Next'));
      currentItemRef = nextItem instanceof PDFRef ? nextItem : null;
    }
  }

  if (rootFirstRef && rootPrevRef) {
    mergedOutlinesDict.set(PDFName.of('First'), rootFirstRef);
    mergedOutlinesDict.set(PDFName.of('Last'), rootPrevRef);
    mergedOutlinesDict.set(PDFName.of('Count'), PDFNumber.of(rootCount));
  } else {
    // If no bookmarks were transferred, remove unused Outlines catalog entry
    mergedDoc.catalog.delete(PDFName.of('Outlines'));
  }
}

/**
 * Draws page numbers ("X / Y") at the bottom center of each page in the merged document,
 * respecting the page's orientation/rotation.
 */
async function addPageNumbersToDocument(mergedDoc: PDFDocument): Promise<void> {
  const font = await mergedDoc.embedFont(StandardFonts.Helvetica);
  const totalPages = mergedDoc.getPageCount();
  const fontSize = 10;
  const textColor = rgb(0.25, 0.25, 0.25);
  const margin = 20;

  for (let i = 0; i < totalPages; i++) {
    const page = mergedDoc.getPage(i);
    const { width, height } = page.getSize();
    const text = `${i + 1} / ${totalPages}`;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const rot = ((page.getRotation().angle % 360) + 360) % 360;

    if (rot === 0) {
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: margin,
        size: fontSize,
        font,
        color: textColor,
        rotate: degrees(0),
      });
    } else if (rot === 90) {
      page.drawText(text, {
        x: width - margin,
        y: (height - textWidth) / 2,
        size: fontSize,
        font,
        color: textColor,
        rotate: degrees(90),
      });
    } else if (rot === 180) {
      page.drawText(text, {
        x: (width + textWidth) / 2,
        y: height - margin,
        size: fontSize,
        font,
        color: textColor,
        rotate: degrees(180),
      });
    } else if (rot === 270) {
      page.drawText(text, {
        x: margin,
        y: (height + textWidth) / 2,
        size: fontSize,
        font,
        color: textColor,
        rotate: degrees(270),
      });
    }
  }
}

/**
 * Merge multiple PDF buffers sequentially into a single PDF document.
 */
export async function mergePdfs(
  pdfBuffers: Uint8Array[],
  options: MergeOptions = {}
): Promise<Uint8Array> {
  if (pdfBuffers.length === 0) {
    throw new Error('No PDF files provided to merge.');
  }

  const mergedDoc = await PDFDocument.create();
  const loadedSources: { doc: PDFDocument; pageOffset: number; pageCount: number }[] = [];
  let currentOffset = 0;

  for (const buffer of pdfBuffers) {
    const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pageIndices = srcDoc.getPageIndices();
    const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);

    for (const page of copiedPages) {
      mergedDoc.addPage(page);
    }

    loadedSources.push({
      doc: srcDoc,
      pageOffset: currentOffset,
      pageCount: pageIndices.length,
    });

    currentOffset += pageIndices.length;
  }

  // Preserve outlines/bookmarks if requested (defaults to true)
  if (options.keepBookmarks !== false) {
    transferBookmarks(mergedDoc, loadedSources);
  }

  // Add page numbers if requested
  if (options.addPageNumbers) {
    await addPageNumbersToDocument(mergedDoc);
  }

  return await mergedDoc.save();
}
