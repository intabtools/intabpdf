// PDF.js helpers for loading a PDF and drawing a page onto a canvas.
import './pdfjs-polyfills';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  buildPageTextCache,
  clearTextCache,
  getCachedPageText,
  setCachedPageText,
} from './textCache';
import type { PdfLinkService } from './pdfLinks';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export type PdfDocument = pdfjsLib.PDFDocumentProxy;

// Keep the loading task so cleanup works with PDF.js versions where the proxy
// does not expose destroy(). The loading task owns the worker/document lifecycle.
const loadingTasks = new WeakMap<PdfDocument, pdfjsLib.PDFDocumentLoadingTask>();

export interface PageSize {
  width: number;
  height: number;
}

export interface LoadPdfOptions {
  onPassword?: (
    updatePassword: (password: string | Error) => void,
    reason: number,
  ) => void;
  onLoadingTask?: (loadingTask: pdfjsLib.PDFDocumentLoadingTask) => void;
}

export async function loadPdf(
  bytes: Uint8Array,
  options?: LoadPdfOptions,
): Promise<PdfDocument> {
  // Copy the bytes so PDF.js transferring data to its worker cannot detach the caller's buffer.
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  if (options?.onLoadingTask) {
    options.onLoadingTask(loadingTask);
  }
  if (options?.onPassword) {
    loadingTask.onPassword = options.onPassword;
  }
  try {
    const doc = await loadingTask.promise;
    loadingTasks.set(doc, loadingTask);
    return doc;
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    throw error;
  }
}

/** Destroy a document through the PDF.js loading task that created it. */
export async function destroyPdf(doc: PdfDocument): Promise<void> {
  clearTextCache(doc);
  const loadingTask = loadingTasks.get(doc);
  if (!loadingTask) return;
  loadingTasks.delete(doc);
  await loadingTask.destroy();
}

export async function getPageSize(
  doc: PdfDocument,
  pageNumber: number,
): Promise<PageSize> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

export const MAX_CANVAS_DIMENSION = 4096;
export const MAX_CANVAS_PIXELS = 16777216; // 16 megapixels

export function drawPageOnCanvas(
  doc: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
): { promise: Promise<void>; cancel: () => void } {
  let renderTask: pdfjsLib.RenderTask | null = null;
  let cancelled = false;

  const promise = (async () => {
    const page = await doc.getPage(pageNumber);
    if (cancelled) return;

    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const displayViewport = page.getViewport({ scale });

    let renderScale = scale * devicePixelRatio;
    const testViewport = page.getViewport({ scale: renderScale });
    const unconstrainedWidth = testViewport.width;
    const unconstrainedHeight = testViewport.height;

    if (
      unconstrainedWidth > MAX_CANVAS_DIMENSION ||
      unconstrainedHeight > MAX_CANVAS_DIMENSION ||
      unconstrainedWidth * unconstrainedHeight > MAX_CANVAS_PIXELS
    ) {
      const dimFactor = Math.min(
        MAX_CANVAS_DIMENSION / unconstrainedWidth,
        MAX_CANVAS_DIMENSION / unconstrainedHeight,
      );
      const pixelFactor = Math.sqrt(MAX_CANVAS_PIXELS / (unconstrainedWidth * unconstrainedHeight));
      renderScale *= Math.min(dimFactor, pixelFactor, 1);
    }

    const renderViewport = page.getViewport({ scale: renderScale });
    const targetWidth = Math.max(1, Math.floor(renderViewport.width));
    const targetHeight = Math.max(1, Math.floor(renderViewport.height));
    const dispWidth = `${Math.floor(displayViewport.width)}px`;
    const dispHeight = `${Math.floor(displayViewport.height)}px`;

    // Immediately update CSS display dimensions on the target canvas so existing rendered content
    // visually scales up or down immediately without white flash or blank frames during re-rasterization.
    canvas.style.width = dispWidth;
    canvas.style.height = dispHeight;

    // Use offscreen staging canvas so rendering occurs in the background without wiping
    // the currently visible canvas bitmap before the new rasterization finishes.
    const stagingCanvas = document.createElement('canvas');
    stagingCanvas.width = targetWidth;
    stagingCanvas.height = targetHeight;

    const stagingContext = stagingCanvas.getContext('2d');
    if (!stagingContext) throw new Error('Canvas 2D context unavailable');

    try {
      renderTask = page.render({
        canvas: stagingCanvas,
        canvasContext: stagingContext,
        viewport: renderViewport,
      });
      await renderTask.promise;
    } catch (renderError) {
      if (cancelled) return;
      if (
        renderError instanceof Error &&
        (renderError.name === 'RenderingCancelledException' ||
          renderError.name === 'AbortException')
      ) {
        throw renderError;
      }

      // Memory limit recovery: if rendering at higher scale/DPR fails, fallback to 1x scale
      console.warn(
        `High-resolution render failed for page ${pageNumber}, retrying at 1x DPR:`,
        renderError,
      );
      const fallbackViewport = page.getViewport({ scale });
      stagingCanvas.width = Math.max(1, Math.floor(fallbackViewport.width));
      stagingCanvas.height = Math.max(1, Math.floor(fallbackViewport.height));
      renderTask = page.render({
        canvas: stagingCanvas,
        canvasContext: stagingContext,
        viewport: fallbackViewport,
      });
      await renderTask.promise;
    }

    if (cancelled) return;

    // In a single synchronous turn, update destination canvas dimensions and blit the newly
    // completed raster image. Because width assignment and drawImage occur in the same JS tick,
    // the browser never paints a blank white frame.
    canvas.width = stagingCanvas.width;
    canvas.height = stagingCanvas.height;
    canvas.style.width = dispWidth;
    canvas.style.height = dispHeight;

    const destContext = canvas.getContext('2d');
    if (destContext && typeof destContext.drawImage === 'function') {
      destContext.drawImage(stagingCanvas, 0, 0);
    }

    // Immediately release staging canvas buffer memory
    stagingCanvas.width = 0;
    stagingCanvas.height = 0;
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      renderTask?.cancel();
    },
  };
}

export function renderPageTextLayer(
  doc: PdfDocument,
  pageNumber: number,
  container: HTMLDivElement,
  scale: number,
): { promise: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let textLayerInstance: pdfjsLib.TextLayer | null = null;

  const promise = (async () => {
    const page = await doc.getPage(pageNumber);
    if (cancelled) return;

    const viewport = page.getViewport({ scale });
    container.innerHTML = '';
    container.style.width = `${Math.floor(viewport.width)}px`;
    container.style.height = `${Math.floor(viewport.height)}px`;
    container.style.setProperty('--scale-factor', `${viewport.scale}`);
    container.style.setProperty('--total-scale-factor', `${viewport.scale}`);
    container.style.setProperty('--scale-round-x', '1px');
    container.style.setProperty('--scale-round-y', '1px');

    const textContentSource = await page.getTextContent();
    if (cancelled) return;

    if (
      textContentSource &&
      Array.isArray(textContentSource.items) &&
      !getCachedPageText(doc, pageNumber)
    ) {
      setCachedPageText(
        doc,
        pageNumber,
        buildPageTextCache(pageNumber, textContentSource.items),
      );
    }

    try {
      textLayerInstance = new pdfjsLib.TextLayer({
        textContentSource,
        container,
        viewport,
      });
      await textLayerInstance.render();
    } catch {
      if (cancelled) return;
      // Fallback for mock/test environments without full canvas font measurement
      if (textContentSource && Array.isArray(textContentSource.items)) {
        container.innerHTML = '';
        for (const item of textContentSource.items) {
          if (item && typeof item === 'object' && 'str' in item && typeof (item as { str: string }).str === 'string') {
            const span = document.createElement('span');
            span.textContent = (item as { str: string }).str;
            container.appendChild(span);
          }
        }
      }
    }
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      try {
        textLayerInstance?.cancel();
      } catch {
        // ignore
      }
    },
  };
}

export function renderPageAnnotationLayer(
  doc: PdfDocument,
  pageNumber: number,
  container: HTMLDivElement,
  scale: number,
  linkService: PdfLinkService,
): { promise: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let annotationLayerInstance: pdfjsLib.AnnotationLayer | null = null;

  const promise = (async () => {
    const page = await doc.getPage(pageNumber);
    if (cancelled) return;

    const viewport = page.getViewport({ scale });
    container.innerHTML = '';
    container.style.width = `${Math.floor(viewport.width)}px`;
    container.style.height = `${Math.floor(viewport.height)}px`;
    container.style.setProperty('--scale-factor', `${viewport.scale}`);
    container.style.setProperty('--total-scale-factor', `${viewport.scale}`);
    container.style.setProperty('--scale-round-x', '1px');
    container.style.setProperty('--scale-round-y', '1px');

    const annotations = await page.getAnnotations({ intent: 'display' });
    if (cancelled) return;

    if (!annotations || annotations.length === 0) {
      return;
    }

    try {
      type AnnotationLayerConstructor = new (params: unknown) => pdfjsLib.AnnotationLayer;
      annotationLayerInstance = new (pdfjsLib.AnnotationLayer as unknown as AnnotationLayerConstructor)({
        div: container,
        page,
        viewport,
        linkService,
      });
      await (annotationLayerInstance.render as (params: unknown) => Promise<void>)({
        annotations,
        viewport,
        linkService,
      });
    } catch {
      if (cancelled) return;
      // Fallback for mock/test environments
      container.innerHTML = '';
      for (const annot of annotations) {
        if (!annot || annot.hidden) continue;
        const isLink =
          annot.annotationType === 1 ||
          annot.subtype === 'Link' ||
          !!annot.url ||
          !!annot.dest;
        if (!isLink || !annot.rect) continue;

        const [x1, y1, x2, y2] = annot.rect;
        const rect = [
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.max(x1, x2),
          Math.max(y1, y2),
        ];

        const pageView = page.view || [0, 0, viewport.width, viewport.height];
        const normalizedRect = [
          rect[0],
          pageView[3] - rect[3] + pageView[1],
          rect[2],
          pageView[3] - rect[1] + pageView[1],
        ];

        const rawDims = (
          viewport as unknown as {
            rawDims?: {
              pageWidth: number;
              pageHeight: number;
              pageX: number;
              pageY: number;
            };
          }
        ).rawDims;
        const pageWidth = rawDims?.pageWidth || viewport.width;
        const pageHeight = rawDims?.pageHeight || viewport.height;
        const pageX = rawDims?.pageX || 0;
        const pageY = rawDims?.pageY || 0;

        const left = (100 * (normalizedRect[0] - pageX)) / pageWidth;
        const top = (100 * (normalizedRect[1] - pageY)) / pageHeight;
        const width = (100 * (rect[2] - rect[0])) / pageWidth;
        const height = (100 * (rect[3] - rect[1])) / pageHeight;

        const section = document.createElement('section');
        section.className = 'linkAnnotation';
        section.style.left = `${left}%`;
        section.style.top = `${top}%`;
        section.style.width = `${width}%`;
        section.style.height = `${height}%`;

        const link = document.createElement('a');
        if (annot.url) {
          linkService.addLinkAttributes(link, annot.url);
        } else if (annot.dest) {
          link.href = linkService.getDestinationHash(annot.dest);
          link.onclick = (e) => {
            e.preventDefault();
            void linkService.goToDestination(annot.dest);
            return false;
          };
        } else if (annot.action) {
          link.href = '#';
          link.onclick = (e) => {
            e.preventDefault();
            linkService.executeNamedAction(annot.action);
            return false;
          };
        }
        section.appendChild(link);
        container.appendChild(section);
      }
    }
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      try {
        annotationLayerInstance?.destroy?.();
      } catch {
        // ignore
      }
    },
  };
}
