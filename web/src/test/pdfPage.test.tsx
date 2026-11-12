import { cleanup, render, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfPage } from '../components/viewer/PdfPage';
import { useViewer } from '../state/viewer';

function cancelledError(): Error {
  const error = new Error('Rendering cancelled');
  error.name = 'RenderingCancelledException';
  return error;
}

describe('pdf page drawing', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');

  afterEach(() => {
    cleanup();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    if (widthDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, 'width', widthDescriptor);
    useViewer.setState({ page: 1, findTick: 0, findOpen: false, findHits: [], findIndex: -1 });
  });

  it('cancels the in-flight draw before resizing the canvas for a new scale', async () => {
    const events: string[] = [];
    if (!widthDescriptor?.set || !widthDescriptor.get) throw new Error('canvas width is not configurable');
    const { get, set } = widthDescriptor;
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
      configurable: true,
      enumerable: widthDescriptor.enumerable,
      get,
      set(value: number) {
        events.push(`width:${value}`);
        set.call(this, value);
      },
    });
    HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext'];
    if (!('IntersectionObserver' in globalThis)) {
      globalThis.IntersectionObserver = class {
        observe() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as unknown as typeof IntersectionObserver;
    }

    const tasks: Array<{ cancel: () => void; promise: Promise<void> }> = [];
    const doc = {
      getPage: async () => ({
        rotate: 0,
        getViewport({ scale }: { scale: number }) {
          return { width: 100 * scale, height: 140 * scale };
        },
        render() {
          let reject = (_error: Error) => {};
          const promise = new Promise<void>((_resolve, nextReject) => {
            reject = nextReject;
          });
          const task = {
            promise,
            cancel() {
              events.push('cancel');
              reject(cancelledError());
            },
          };
          tasks.push(task);
          events.push('render');
          return task;
        },
        getTextContent: async () => ({ items: [] }),
      }),
    } as unknown as PDFDocumentProxy;

    useViewer.setState({ page: 1, findTick: 0, findOpen: false });
    const view = render(<PdfPage doc={doc} pageNumber={1} scale={1} />);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    await waitFor(() => expect(events).toEqual([`width:${100 * ratio}`, 'render']));

    view.rerender(<PdfPage doc={doc} pageNumber={1} scale={2} />);
    await waitFor(() => expect(events).toContain(`width:${200 * ratio}`));

    const secondWidth = events.indexOf(`width:${200 * ratio}`);
    expect(events.indexOf('cancel')).toBeGreaterThan(-1);
    expect(events.indexOf('cancel')).toBeLessThan(secondWidth);
    expect(events.indexOf('render', events.indexOf('render') + 1)).toBeGreaterThan(secondWidth);
    expect(tasks).toHaveLength(2);
  });
});
