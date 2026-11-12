import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PDFDocument } from 'pdf-lib';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfViewer } from '../components/viewer/PdfViewer';
import { pageFitZoom, zoomForStoredFit } from '../components/viewer/fitZoom';
import { useSplit } from '../state/splitView';
import { useViewer } from '../state/viewer';

describe('page fit zoom', () => {
  it('fits the page width and reserves a vertical scrollbar once', () => {
    expect(
      pageFitZoom({
        mode: 'width',
        pageWidth: 100,
        pageHeight: 100,
        viewWidth: 200,
        viewHeight: 100,
        reservedX: 0,
        reservedY: 0,
        scrollbar: 20,
        pageCount: 2,
      }),
    ).toBe(1.79);

    expect(
      pageFitZoom({
        mode: 'width',
        pageWidth: 100,
        pageHeight: 100,
        viewWidth: 200,
        viewHeight: 100,
        reservedX: 16,
        reservedY: 0,
        scrollbar: 16,
        pageCount: 2,
      }),
    ).toBe(1.99);
  });

  it('fits the page height and reserves a horizontal scrollbar once', () => {
    expect(
      pageFitZoom({
        mode: 'height',
        pageWidth: 200,
        pageHeight: 100,
        viewWidth: 100,
        viewHeight: 200,
        reservedX: 0,
        reservedY: 0,
        scrollbar: 15,
        pageCount: 1,
      }),
    ).toBe(1.84);
  });

  it('leaves a single short page at the full width', () => {
    expect(
      pageFitZoom({
        mode: 'width',
        pageWidth: 100,
        pageHeight: 50,
        viewWidth: 200,
        viewHeight: 200,
        reservedX: 0,
        reservedY: 0,
        scrollbar: 16,
        pageCount: 1,
      }),
    ).toBe(1.99);
  });

  it('caps a very wide view and ignores a view that is not laid out', () => {
    expect(
      pageFitZoom({
        mode: 'width',
        pageWidth: 10,
        pageHeight: 10,
        viewWidth: 1000,
        viewHeight: 1000,
        reservedX: 0,
        reservedY: 0,
        scrollbar: 0,
        pageCount: 1,
      }),
    ).toBe(4);
    expect(
      pageFitZoom({
        mode: 'width',
        pageWidth: 100,
        pageHeight: 100,
        viewWidth: 0,
        viewHeight: 0,
        reservedX: 0,
        reservedY: 0,
        scrollbar: 0,
        pageCount: 1,
      }),
    ).toBeNull();
  });

  it('uses 70 percent of fit-width for the single fit', () => {
    expect(zoomForStoredFit('width', 1.79)).toBe(1.79);
    expect(zoomForStoredFit('single', 1.79)).toBe(1.253);
    expect(zoomForStoredFit('single', null)).toBeNull();
  });
});

describe('pdf viewer fit controls', () => {
  let doc: PDFDocumentProxy | null = null;
  let previousGetContext: HTMLCanvasElement['getContext'] | null = null;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();

  afterEach(async () => {
    cleanup();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
    descriptors.clear();
    if (previousGetContext) HTMLCanvasElement.prototype.getContext = previousGetContext;
    act(() => {
      useViewer.setState({
        doc: null,
        file: null,
        page: 1,
        pageCount: 0,
        zoom: 1,
        fit: 'width',
        loading: false,
        findQuery: '',
        findHits: [],
        findIndex: -1,
        findTick: 0,
        thumbOpen: false,
      });
    });
    await doc?.destroy();
    doc = null;
    useSplit.setState({ open: false });
  });

  it('opens at fit-width and switches to fit-height', async () => {
    for (const key of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'] as const) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    }
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 900 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 900 });
    previousGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext'];
    if (!('ResizeObserver' in globalThis)) {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    if (!('IntersectionObserver' in globalThis)) {
      globalThis.IntersectionObserver = class {
        observe() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as unknown as typeof IntersectionObserver;
    }

    const pdf = await PDFDocument.create();
    pdf.addPage([400, 600]);
    doc = await getDocument({
      data: await pdf.save(),
      disableWorker: true,
      isEvalSupported: false,
    } as Parameters<typeof getDocument>[0]).promise;
    const viewport = (await doc.getPage(1)).getViewport({ scale: 1 });

    act(() => {
      useViewer.setState({ doc, page: 1, pageCount: 1, zoom: 1, fit: 'width', loading: false, findQuery: '' });
    });
    render(<PdfViewer />);

    await waitFor(() => {
      const zoom = useViewer.getState().zoom;
      expect(zoom).toBeGreaterThan(1);
      expect(viewport.width * zoom).toBeLessThanOrEqual(800);
      expect(viewport.width * zoom).toBeGreaterThan(700);
    });
    expect(screen.getByRole('button', { name: '폭맞춤' }).getAttribute('aria-pressed')).toBe('true');

    const widthZoom = useViewer.getState().zoom;
    fireEvent.click(screen.getByRole('button', { name: '높이맞춤' }));
    await waitFor(() => {
      const zoom = useViewer.getState().zoom;
      expect(useViewer.getState().fit).toBe('height');
      expect(zoom).toBeLessThan(widthZoom);
      expect(viewport.height * zoom).toBeLessThanOrEqual(900);
      expect(viewport.height * zoom).toBeGreaterThan(700);
    });
    expect(screen.getByRole('button', { name: '높이맞춤' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '폭맞춤' }));
    await waitFor(() => {
      const zoom = useViewer.getState().zoom;
      expect(useViewer.getState().fit).toBe('width');
      expect(zoom).toBeGreaterThan(1);
      expect(viewport.width * zoom).toBeLessThanOrEqual(800);
      expect(viewport.width * zoom).toBeGreaterThan(700);
    });

    fireEvent.click(screen.getByRole('button', { name: '확대' }));
    const custom = useViewer.getState().zoom;
    expect(useViewer.getState().fit).toBe('custom');
    expect(custom).toBeGreaterThan(widthZoom);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useViewer.getState().fit).toBe('custom');
    expect(useViewer.getState().zoom).toBe(custom);

    const scroller = document.querySelector('.viewer-scroll');
    if (!(scroller instanceof HTMLElement)) throw new Error('missing scroller');
    const zoomIn = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true });
    act(() => {
      scroller.dispatchEvent(zoomIn);
    });
    const wheeled = useViewer.getState().zoom;
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(useViewer.getState().fit).toBe('custom');
    expect(wheeled).toBeGreaterThan(custom);
    const scroll = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    act(() => {
      scroller.dispatchEvent(scroll);
    });
    expect(scroll.defaultPrevented).toBe(false);
    expect(useViewer.getState().zoom).toBe(wheeled);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useViewer.getState().fit).toBe('custom');
    expect(useViewer.getState().zoom).toBe(wheeled);
  });

  it('keeps the single fit at 70 percent of fit-width and uses full fit-width for two views', async () => {
    for (const key of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'] as const) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    }
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 900 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 900 });
    previousGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext'];
    if (!('ResizeObserver' in globalThis)) {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    if (!('IntersectionObserver' in globalThis)) {
      globalThis.IntersectionObserver = class {
        observe() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as unknown as typeof IntersectionObserver;
    }

    const pdf = await PDFDocument.create();
    pdf.addPage([400, 600]);
    doc = await getDocument({
      data: await pdf.save(),
      disableWorker: true,
      isEvalSupported: false,
    } as Parameters<typeof getDocument>[0]).promise;

    act(() => {
      useSplit.setState({ open: false });
      useViewer.setState({ doc, page: 1, pageCount: 1, zoom: 1, fit: 'single', loading: false, findQuery: '' });
    });
    render(<PdfViewer />);

    await waitFor(() => {
      expect(useViewer.getState().zoom).toBeGreaterThan(1);
    });
    const singleZoom = useViewer.getState().zoom;
    expect(useViewer.getState().fit).toBe('single');
    expect(screen.getByRole('button', { name: '폭맞춤' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '폭맞춤' }));
    await waitFor(() => {
      expect(useViewer.getState().fit).toBe('width');
      expect(useViewer.getState().zoom).toBeGreaterThan(singleZoom);
    });
    const widthZoom = useViewer.getState().zoom;
    expect(singleZoom / widthZoom).toBeGreaterThan(0.68);
    expect(singleZoom / widthZoom).toBeLessThan(0.72);

    act(() => {
      useViewer.setState({ fit: 'single' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'PDF 2개 보기' }));
    await waitFor(() => {
      expect(useViewer.getState().fit).toBe('width');
    });
    fireEvent.click(screen.getByRole('button', { name: 'PDF 2개 보기' }));
    await waitFor(() => {
      expect(useViewer.getState().fit).toBe('single');
      expect(screen.getByRole('button', { name: '폭맞춤' }).getAttribute('aria-pressed')).toBe('false');
    });
  });
});
