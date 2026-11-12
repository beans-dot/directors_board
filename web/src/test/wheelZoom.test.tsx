import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfViewer } from '../components/viewer/PdfViewer';
import { wheelDeltaPixels, zoomFromWheel } from '../components/viewer/wheelZoom';
import { useSplit } from '../state/splitView';
import { useViewer } from '../state/viewer';

function wheel(target: Element, init: WheelEventInit) {
  const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('ctrl wheel zoom', () => {
  afterEach(() => {
    cleanup();
    useViewer.setState({ doc: null, file: null, zoom: 1, fit: 'width', loading: false });
    useSplit.setState({ open: false, doc: null, file: null, zoom: 1, fit: 'width', loading: false });
  });

  it('scales with the wheel and stays inside the zoom range', () => {
    expect(zoomFromWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomFromWheel(1, 100)).toBeLessThan(1);
    expect(zoomFromWheel(1, 0)).toBe(1);
    expect(zoomFromWheel(4, -100)).toBe(4);
    expect(zoomFromWheel(0.25, 100)).toBe(0.25);
    expect(Math.abs(zoomFromWheel(1, -4) - 1)).toBeLessThan(Math.abs(zoomFromWheel(1, -100) - 1));
    expect(wheelDeltaPixels(3, 1)).toBe(48);
    expect(wheelDeltaPixels(1, 2)).toBe(400);
  });

  it('zooms the pdf area on ctrl or pinch and leaves a normal wheel alone', () => {
    useViewer.setState({ doc: null, zoom: 1, fit: 'width', loading: false });
    render(<PdfViewer />);
    const scroller = document.querySelector('.viewer-scroll');
    if (!(scroller instanceof HTMLElement)) throw new Error('missing scroller');

    const zoomIn = wheel(scroller, { ctrlKey: true, deltaY: -100 });
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(useViewer.getState().fit).toBe('custom');
    const zoomed = useViewer.getState().zoom;
    expect(zoomed).toBeGreaterThan(1);

    const pinch = wheel(scroller, { ctrlKey: true, deltaY: 40 });
    expect(pinch.defaultPrevented).toBe(true);
    const afterPinch = useViewer.getState().zoom;
    expect(afterPinch).toBeLessThan(zoomed);

    const plain = wheel(scroller, { deltaY: -100 });
    expect(plain.defaultPrevented).toBe(false);
    expect(useViewer.getState().zoom).toBe(afterPinch);
  });

  it('zooms only the pane under the pointer', () => {
    useViewer.setState({ doc: null, zoom: 1, fit: 'custom', loading: false });
    useSplit.setState({ open: true, doc: null, zoom: 1, fit: 'custom', loading: false });
    render(<PdfViewer />);
    const right = screen.getByRole('region', { name: '오른쪽 PDF' }).querySelector('.viewer-scroll');
    const left = document.querySelector('.viewer-scroll');
    if (!(right instanceof HTMLElement) || !(left instanceof HTMLElement)) throw new Error('missing scroller');

    const rightEvent = wheel(right, { ctrlKey: true, deltaY: -100 });
    expect(rightEvent.defaultPrevented).toBe(true);
    expect(useSplit.getState().zoom).toBeGreaterThan(1);
    expect(useSplit.getState().fit).toBe('custom');
    expect(useViewer.getState().zoom).toBe(1);

    wheel(left, { metaKey: true, deltaY: 100 });
    expect(useViewer.getState().zoom).toBeLessThan(1);
    expect(useViewer.getState().fit).toBe('custom');
    expect(useSplit.getState().zoom).toBeGreaterThan(1);
  });
});
