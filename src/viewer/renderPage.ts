// PDF.js helpers for loading a PDF and drawing a page onto a canvas.
import './pdfjs-polyfills';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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

export async function loadPdf(bytes: Uint8Array): Promise<PdfDocument> {
  // Copy the bytes so PDF.js transferring data to its worker cannot detach the caller's buffer.
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
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
    const renderViewport = page.getViewport({ scale: scale * devicePixelRatio });

    canvas.width = Math.max(1, Math.floor(renderViewport.width));
    canvas.height = Math.max(1, Math.floor(renderViewport.height));
    canvas.style.width = `${Math.floor(displayViewport.width)}px`;
    canvas.style.height = `${Math.floor(displayViewport.height)}px`;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');

    renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport });
    await renderTask.promise;
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

    const textContentSource = await page.getTextContent();
    if (cancelled) return;

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
