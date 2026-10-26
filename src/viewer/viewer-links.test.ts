import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPdfLinkService, isValidExternalUrl } from './pdfLinks';
import { openExternalUrl } from '../platform';
import { renderPageAnnotationLayer } from './renderPage';
import type { PdfDocument } from './renderPage';

interface MockElement {
  tagName: string;
  className: string;
  style: Record<string, string>;
  children: MockElement[];
  attrs: Map<string, string>;
  title?: string;
  href?: string;
  target?: string;
  rel?: string;
  onclick: ((e: MockEvent) => boolean | void) | null;
  setAttribute(name: string, val: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  appendChild(child: MockElement): MockElement;
  querySelector(sel: string): MockElement | null;
  querySelectorAll(sel: string): MockElement[];
  dispatchEvent(event: MockEvent): boolean;
  setProperty(prop: string, val: string): void;
}

interface MockEvent {
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

function createMockElement(tag: string): MockElement {
  const attrs = new Map<string, string>();
  const styleProps: Record<string, string> = {};
  const styleProxy = new Proxy(styleProps, {
    get(target, prop: string) {
      return target[prop] ?? '';
    },
    set(target, prop: string, val: string) {
      target[prop] = val;
      return true;
    },
  });

  const el: MockElement = {
    tagName: tag.toUpperCase(),
    className: '',
    style: styleProxy,
    children: [],
    attrs,
    onclick: null,
    setAttribute(name: string, val: string) {
      attrs.set(name, String(val));
      if (name === 'href') el.href = String(val);
      if (name === 'target') el.target = String(val);
      if (name === 'rel') el.rel = String(val);
      if (name === 'title') el.title = String(val);
    },
    getAttribute(name: string) {
      if (name === 'href') return el.href ?? attrs.get('href') ?? null;
      if (name === 'target') return el.target ?? attrs.get('target') ?? null;
      if (name === 'rel') return el.rel ?? attrs.get('rel') ?? null;
      if (name === 'title') return el.title ?? attrs.get('title') ?? null;
      return attrs.get(name) ?? null;
    },
    removeAttribute(name: string) {
      attrs.delete(name);
      if (name === 'href') delete el.href;
      if (name === 'target') delete el.target;
      if (name === 'rel') delete el.rel;
      if (name === 'title') delete el.title;
    },
    appendChild(child: MockElement) {
      el.children.push(child);
      return child;
    },
    querySelector(sel: string): MockElement | null {
      for (const child of el.children) {
        if (sel === 'a' && child.tagName === 'A') return child;
        if (sel.includes('linkAnnotation') && child.className.includes('linkAnnotation')) return child;
        const sub = child.querySelector(sel);
        if (sub) return sub;
      }
      return null;
    },
    querySelectorAll(sel: string): MockElement[] {
      const results: MockElement[] = [];
      for (const child of el.children) {
        if (sel === 'a' && child.tagName === 'A') results.push(child);
        if (sel.includes('linkAnnotation') && child.className.includes('linkAnnotation')) results.push(child);
        results.push(...child.querySelectorAll(sel));
      }
      return results;
    },
    dispatchEvent(event: MockEvent) {
      if (el.onclick) {
        el.onclick(event);
      }
      return !event.defaultPrevented;
    },
    setProperty(prop: string, val: string) {
      styleProps[prop] = val;
    },
  };

  // Provide style.setProperty for CSS variable simulation
  (styleProxy as unknown as { setProperty: (p: string, v: string) => void }).setProperty = (p, v) => {
    styleProps[p] = v;
  };

  return el;
}

function createMockEvent(): MockEvent {
  return {
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
  };
}

describe('PDF Link Functionality & Navigation', () => {
  let mockWindowOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockWindowOpen = vi.fn(() => ({ closed: false } as Window));

    vi.stubGlobal('window', {
      open: mockWindowOpen,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      intab: undefined,
    });

    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => createMockElement(tag)),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('URL Scheme Security & Validation', () => {
    it('accepts valid HTTP and HTTPS URLs', () => {
      expect(isValidExternalUrl('http://example.com')).toBe(true);
      expect(isValidExternalUrl('https://example.com')).toBe(true);
      expect(isValidExternalUrl('https://example.com/path/to/doc?query=1&b=2#sec')).toBe(true);
      expect(isValidExternalUrl('  https://github.com/intabtools/intabpdf  ')).toBe(true);
    });

    it('rejects unsafe, non-HTTP, and malformed URL schemes', () => {
      expect(isValidExternalUrl('javascript:alert(1)')).toBe(false);
      expect(isValidExternalUrl('file:///etc/passwd')).toBe(false);
      expect(isValidExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isValidExternalUrl('intent://some-intent#Intent;scheme=app;end')).toBe(false);
      expect(isValidExternalUrl('content://media/external/images')).toBe(false);
      expect(isValidExternalUrl('blob:http://example.com/uuid')).toBe(false);
      expect(isValidExternalUrl('chrome://settings')).toBe(false);
      expect(isValidExternalUrl('not a url')).toBe(false);
      expect(isValidExternalUrl('')).toBe(false);
      expect(isValidExternalUrl(null as unknown as string)).toBe(false);
      expect(isValidExternalUrl(undefined as unknown as string)).toBe(false);
    });

    it('blocks openExternalUrl from launching unsafe schemes', () => {
      openExternalUrl('javascript:alert(1)');
      openExternalUrl('file:///home/user/secret.pdf');
      openExternalUrl('data:text/plain;base64,SGVsbG8=');

      expect(mockWindowOpen).not.toHaveBeenCalled();

      openExternalUrl('https://example.com');
      expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    });

    it('delegates to Electron window.intab.openExternalUrl on desktop', () => {
      const mockIntabOpen = vi.fn();
      window.intab = {
        openExternalUrl: mockIntabOpen,
        onOpenPdf: vi.fn(),
      };

      openExternalUrl('https://example.com/electron-test');
      expect(mockIntabOpen).toHaveBeenCalledWith('https://example.com/electron-test');
      expect(mockWindowOpen).not.toHaveBeenCalled();
    });
  });

  describe('PdfLinkService & Attribute Binding', () => {
    const createMockDoc = (overrides?: Partial<PdfDocument>): PdfDocument => {
      return {
        numPages: 5,
        getPage: vi.fn(),
        getDestination: vi.fn(),
        getPageIndex: vi.fn(),
        destroy: vi.fn(),
        ...overrides,
      } as unknown as PdfDocument;
    };

    it('correctly configures valid external links with secure target and rel', () => {
      const doc = createMockDoc();
      const onNavigate = vi.fn();
      const linkService = createPdfLinkService(doc, onNavigate);

      const link = document.createElement('a') as unknown as HTMLAnchorElement;
      linkService.addLinkAttributes(link, 'https://example.com/research.pdf');

      expect(link.getAttribute('href')).toBe('https://example.com/research.pdf');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('title')).toBe('https://example.com/research.pdf');

      const event = createMockEvent();
      (link as unknown as MockElement).dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(mockWindowOpen).toHaveBeenCalledWith(
        'https://example.com/research.pdf',
        '_blank',
        'noopener,noreferrer'
      );
    });

    it('disarms unsafe or malformed external links on binding', () => {
      const doc = createMockDoc();
      const onNavigate = vi.fn();
      const linkService = createPdfLinkService(doc, onNavigate);

      const link = document.createElement('a') as unknown as HTMLAnchorElement;
      linkService.addLinkAttributes(link, 'javascript:window.location="http://evil.com"');

      expect(link.getAttribute('href')).toBeNull();
      expect((link as unknown as MockElement).style.pointerEvents).toBe('none');
      expect(link.getAttribute('title')).toContain('Blocked');

      const event = createMockEvent();
      (link as unknown as MockElement).dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(mockWindowOpen).not.toHaveBeenCalled();
    });

    it('resolves named internal destination strings to target pages', async () => {
      const mockGetDestination = vi.fn().mockImplementation((name: string) => {
        if (name === 'chapter2') {
          return Promise.resolve([{ num: 15, gen: 0 }, { name: 'XYZ' }, 0, 500, 1]);
        }
        return Promise.resolve(null);
      });
      const mockGetPageIndex = vi.fn().mockImplementation((ref: { num: number }) => {
        if (ref.num === 15) return Promise.resolve(1); // 0-based page index 1 = page 2
        return Promise.resolve(-1);
      });

      const doc = createMockDoc({
        getDestination: mockGetDestination,
        getPageIndex: mockGetPageIndex,
      });

      const onNavigate = vi.fn();
      const linkService = createPdfLinkService(doc, onNavigate);

      await linkService.goToDestination('chapter2');

      expect(mockGetDestination).toHaveBeenCalledWith('chapter2');
      expect(mockGetPageIndex).toHaveBeenCalledWith({ num: 15, gen: 0 });
      expect(onNavigate).toHaveBeenCalledWith(2);
    });

    it('resolves explicit destination arrays with reference objects', async () => {
      const mockGetPageIndex = vi.fn().mockResolvedValue(3); // page 4 (0-based 3)
      const doc = createMockDoc({ getPageIndex: mockGetPageIndex });
      const onNavigate = vi.fn();
      const linkService = createPdfLinkService(doc, onNavigate);

      await linkService.goToDestination([{ num: 42, gen: 0 }, { name: 'Fit' }]);

      expect(mockGetPageIndex).toHaveBeenCalledWith({ num: 42, gen: 0 });
      expect(onNavigate).toHaveBeenCalledWith(4);
    });

    it('resolves explicit destinations with numeric page indices', async () => {
      const doc = createMockDoc();
      const onNavigate = vi.fn();
      const linkService = createPdfLinkService(doc, onNavigate);

      // 0-based index 2 -> page 3
      await linkService.goToDestination([2, { name: 'XYZ' }]);
      expect(onNavigate).toHaveBeenCalledWith(3);
    });

    it('safely handles missing, invalid, or out-of-bounds destinations without crashing', async () => {
      const doc = createMockDoc({
        getDestination: vi.fn().mockResolvedValue(null),
      });
      const onNavigate = vi.fn();
      const linkService = createPdfLinkService(doc, onNavigate);

      await linkService.goToDestination('non-existent');
      expect(onNavigate).not.toHaveBeenCalled();

      await linkService.goToDestination(null);
      expect(onNavigate).not.toHaveBeenCalled();

      // Target page 99 in a 5-page document
      await linkService.goToDestination([98]);
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('executes standard PDF named navigation actions', () => {
      const doc = createMockDoc({ numPages: 10 });
      const onNavigate = vi.fn();
      const linkService = createPdfLinkService(doc, onNavigate, 4);

      linkService.executeNamedAction('NextPage');
      expect(onNavigate).toHaveBeenCalledWith(5);

      linkService.executeNamedAction('PrevPage');
      expect(onNavigate).toHaveBeenCalledWith(3);

      linkService.executeNamedAction('FirstPage');
      expect(onNavigate).toHaveBeenCalledWith(1);

      linkService.executeNamedAction('LastPage');
      expect(onNavigate).toHaveBeenCalledWith(10);

      // Bounds clamping at page 1
      linkService.setCurrentPage(1);
      linkService.executeNamedAction('PrevPage');
      expect(onNavigate).toHaveBeenCalledWith(1);

      // Bounds clamping at page 10
      linkService.setCurrentPage(10);
      linkService.executeNamedAction('NextPage');
      expect(onNavigate).toHaveBeenCalledWith(10);
    });
  });

  describe('AnnotationLayer Rendering & Hit Area Alignment', () => {
    it('renders link annotation sections positioned according to viewport geometry', async () => {
      const mockPage = {
        view: [0, 0, 600, 800],
        getViewport: vi.fn().mockReturnValue({
          width: 600,
          height: 800,
          scale: 1,
          rawDims: { pageWidth: 600, pageHeight: 800, pageX: 0, pageY: 0 },
        }),
        getAnnotations: vi.fn().mockResolvedValue([
          {
            annotationType: 1, // LINK
            rect: [50, 100, 250, 150],
            url: 'https://example.com/linked',
          },
        ]),
      };

      const doc = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      } as unknown as PdfDocument;

      const container = document.createElement('div') as unknown as HTMLDivElement;
      const onNavigate = vi.fn();
      const linkService = createPdfLinkService(doc, onNavigate);

      const job = renderPageAnnotationLayer(doc, 1, container, 1, linkService);
      await job.promise;

      const section = (container as unknown as MockElement).querySelector('section.linkAnnotation');
      expect(section).not.toBeNull();
      expect(section?.style.left).toBeDefined();
      expect(section?.style.top).toBeDefined();

      const anchor = section?.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toBe('https://example.com/linked');
      expect(anchor?.getAttribute('target')).toBe('_blank');
    });

    it('cancels pending annotation rendering when job is cancelled', async () => {
      const mockPage = {
        view: [0, 0, 600, 800],
        getViewport: vi.fn().mockReturnValue({ width: 600, height: 800, scale: 1 }),
        getAnnotations: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 50))
        ),
      };

      const doc = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      } as unknown as PdfDocument;

      const container = document.createElement('div') as unknown as HTMLDivElement;
      const linkService = createPdfLinkService(doc, vi.fn());

      const job = renderPageAnnotationLayer(doc, 1, container, 1, linkService);
      job.cancel();
      await job.promise;

      // Container remains clean
      expect((container as unknown as MockElement).children.length).toBe(0);
    });
  });
});
