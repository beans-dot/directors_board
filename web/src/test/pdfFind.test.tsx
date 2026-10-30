// @ts-expect-error node:fs is provided by the test runtime
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { FindBar } from '../components/viewer/FindBar';
import { findTextHits, nextFindIndex, type FindTextItem, type FindViewport } from '../domain/pdfFind';
import { useViewer } from '../state/viewer';

const viewport: FindViewport = {
  width: 100,
  height: 100,
  convertToViewportPoint(x, y) {
    return [x, 100 - y];
  },
};

function item(str: string, x: number, y: number, w: number, h: number, extra: Partial<FindTextItem> = {}): FindTextItem {
  return { str, transform: [1, 0, 0, 1, x, y], width: w, height: h, ...extra };
}

describe('pdf find', () => {
  it('highlights only the matched slice and each later occurrence', () => {
    const hits = findTextHits(
      [item('hello world', 10, 50, 110, 10), item('hello world', 10, 20, 110, 10)],
      { ...viewport, width: 200, height: 200, convertToViewportPoint: (x, y) => [x, 200 - y] },
      3,
      'World',
    );
    expect(hits).toHaveLength(2);
    expect(hits[0].page).toBe(3);
    expect(hits[0].rects[0].x).toBeCloseTo(70 / 200);
    expect(hits[0].rects[0].w).toBeCloseTo(50 / 200);
    expect(hits[0].rects[0].y).toBeCloseTo((200 - 60) / 200);
    expect(hits[0].rects[0].h).toBeCloseTo(10 / 200);
  });

  it('joins runs on one line and does not cross a line break', () => {
    const joined = findTextHits(
      [item('AB', 0, 10, 20, 10), item('CD', 20, 10, 20, 10)],
      viewport,
      1,
      'BC',
    );
    expect(joined).toHaveLength(1);
    expect(joined[0].rects).toHaveLength(2);
    expect(joined[0].rects[0].x).toBeCloseTo(0.1);
    expect(joined[0].rects[0].w).toBeCloseTo(0.1);
    expect(joined[0].rects[1].x).toBeCloseTo(0.2);
    expect(joined[0].rects[1].w).toBeCloseTo(0.1);

    const broken = findTextHits(
      [item('안녕', 0, 40, 20, 10, { hasEOL: true }), item('하세요', 0, 20, 30, 10)],
      viewport,
      1,
      '안녕하세요',
    );
    expect(broken).toHaveLength(0);
  });

  it('locates each Korean phrase on the page', async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(new Uint8Array(readFileSync('public/fonts/NanumGothic-Regular.ttf')));
    const page = pdf.addPage([400, 600]);
    page.drawText('이사회 안건', { font, x: 40, y: 520, size: 16 });
    page.drawText('다른 문장', { font, x: 40, y: 480, size: 16 });
    page.drawText('이사회 안건', { font, x: 40, y: 120, size: 16 });
    const doc = await getDocument({
      data: await pdf.save(),
      disableWorker: true,
      isEvalSupported: false,
    } as Parameters<typeof getDocument>[0]).promise;
    const pdfPage = await doc.getPage(1);
    const text = await pdfPage.getTextContent();
    const items = text.items.flatMap((entry) =>
      'str' in entry && entry.str
        ? [{ str: entry.str, hasEOL: entry.hasEOL, dir: entry.dir, transform: entry.transform as number[], width: entry.width, height: entry.height }]
        : [],
    );
    const hits = findTextHits(items, pdfPage.getViewport({ scale: 1 }), 1, '이사회');
    expect(hits).toHaveLength(2);
    expect(hits[0].rects[0].w).toBeGreaterThan(0.02);
    expect(hits[0].rects[0].h).toBeGreaterThan(0.01);
    expect(hits[0].rects[0].y).toBeLessThan(hits[1].rects[0].y);
    expect(hits[0].rects[0].y).toBeGreaterThan(0);
    expect(hits[0].rects[0].y + hits[0].rects[0].h).toBeLessThan(0.2);
  });

  it('steps the find cursor from the first hit and wraps', () => {
    expect(nextFindIndex(-1, 3, 1)).toBe(0);
    expect(nextFindIndex(0, 3, 1)).toBe(1);
    expect(nextFindIndex(2, 3, 1)).toBe(0);
    expect(nextFindIndex(-1, 3, -1)).toBe(2);
    expect(nextFindIndex(0, 1, 1)).toBe(0);
    expect(nextFindIndex(0, 0, 1)).toBe(-1);
  });
});

describe('find bar', () => {
  afterEach(() => {
    cleanup();
    act(() => {
      useViewer.setState({
        findOpen: false,
        findQuery: '',
        findHitQuery: '',
        findHits: [],
        findIndex: -1,
        findTick: 0,
        page: 1,
      });
    });
  });

  it('moves to each hit and highlights the next one on enter', () => {
    useViewer.setState({
      findOpen: true,
      findQuery: '회의',
      findHitQuery: '회의',
      findHits: [
        { page: 2, rects: [{ x: 0.1, y: 0.2, w: 0.1, h: 0.02 }] },
        { page: 4, rects: [{ x: 0.3, y: 0.8, w: 0.2, h: 0.02 }] },
      ],
      findIndex: -1,
      findTick: 0,
      page: 1,
    });
    render(<FindBar />);
    const input = screen.getByLabelText('문서 검색');
    expect(screen.getByText('0/2')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    });
    expect(useViewer.getState().findIndex).toBe(-1);

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(useViewer.getState().findIndex).toBe(0);
    expect(useViewer.getState().page).toBe(2);
    expect(useViewer.getState().findTick).toBe(1);
    expect(screen.getByText('1/2')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(useViewer.getState().findIndex).toBe(1);
    expect(useViewer.getState().page).toBe(4);
    expect(screen.getByText('2/2')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(useViewer.getState().findIndex).toBe(0);
    expect(useViewer.getState().page).toBe(2);
  });

  it('waits until the typed phrase has been found', () => {
    useViewer.setState({
      findOpen: true,
      findQuery: '새문구',
      findHitQuery: '이전',
      findHits: [{ page: 1, rects: [{ x: 0, y: 0, w: 0.1, h: 0.02 }] }],
      findIndex: -1,
      findTick: 0,
    });
    render(<FindBar />);
    act(() => {
      fireEvent.keyDown(screen.getByLabelText('문서 검색'), { key: 'Enter' });
    });
    expect(useViewer.getState().page).toBe(1);
    expect(useViewer.getState().findTick).toBe(0);
  });
});
