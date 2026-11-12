import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePdfDrag, pdfDragPayload } from '../domain/pdfDrag';
import { PdfViewer } from '../components/viewer/PdfViewer';
import { clampSplitRatio, splitRatioFromDrag, useSplit } from '../state/splitView';
import { useViewer } from '../state/viewer';
import type { DriveNode } from '../api/types';

const file: DriveNode = {
  id: 'file-1',
  name: '안건.pdf',
  kind: 'file',
  mimeType: 'application/pdf',
  isPdf: true,
  path: '26.11.03./안건.pdf',
};

describe('split pdf view', () => {
  afterEach(() => {
    useSplit.setState({
      open: false,
      ratio: 0.5,
      file: null,
      doc: null,
      page: 1,
      pageCount: 0,
      zoom: 1,
      fit: 'width',
      thumbOpen: false,
      loading: false,
    });
    useViewer.setState({ doc: null, file: null, local: null, loading: false, tool: 'select', findOpen: false });
  });

  it('moves the mark tools beside the thumbnails and the find tool to the next row', () => {
    render(<PdfViewer />);
    const rows = document.querySelectorAll('.toolbar-row');
    const thumbs = screen.getByRole('button', { name: '썸네일' });
    const select = screen.getByRole('button', { name: '선택' });
    const find = screen.getByRole('button', { name: '찾기' });
    const split = screen.getByRole('button', { name: 'PDF 2개 보기' });
    expect(split.getAttribute('aria-pressed')).toBe('false');
    expect(split.querySelector('.split-switch')).toBeTruthy();
    expect(rows[0]?.contains(thumbs)).toBe(true);
    expect(rows[0]?.contains(select)).toBe(true);
    expect(rows[0]?.contains(screen.getByRole('button', { name: '지우개' }))).toBe(true);
    expect(rows[1]?.contains(find)).toBe(true);
    expect(rows[1]?.contains(split)).toBe(true);
    expect(thumbs.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(find.compareDocumentPosition(split) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('splits the viewer and explains how to drop a pdf', () => {
    render(<PdfViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF 2개 보기' }));
    expect(screen.getByRole('button', { name: 'PDF 2개 보기' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('자료 폴더 영역에서 보고싶은 PDF를 아래 영역으로 드래그 하세요')).toBeTruthy();
    expect(screen.getByRole('region', { name: '오른쪽 PDF' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: '영역 너비' })).toBeTruthy();
    expect(screen.getAllByText('이 영역으로 PDF를 끌어 오세요').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'PDF 2개 보기' }));
    expect(screen.getByRole('button', { name: 'PDF 2개 보기' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('자료 폴더 영역에서 보고싶은 PDF를 아래 영역으로 드래그 하세요')).toBeNull();
  });

  it('shows a closable tab with its own page and zoom controls for each open pdf', () => {
    useViewer.setState({
      file,
      doc: null,
      page: 2,
      pageCount: 3,
      zoom: 1,
      fit: 'custom',
      loading: false,
    });
    useSplit.setState({
      open: true,
      file: { ...file, id: 'file-2', name: '비교.pdf' },
      doc: null,
      page: 1,
      pageCount: 4,
      zoom: 1.5,
      fit: 'custom',
      loading: false,
    });
    render(<PdfViewer />);
    expect(screen.getByText('안건')).toBeTruthy();
    expect(screen.getByText('비교')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '왼쪽 페이지' }) as HTMLInputElement).value).toBe('2');
    expect((screen.getByRole('textbox', { name: '오른쪽 확대 비율' }) as HTMLInputElement).value).toBe('150');
    const rightZoom = screen.getByRole('textbox', { name: '오른쪽 확대 비율' });
    const rightFit = screen.getByRole('button', { name: '오른쪽 폭맞춤' });
    expect(rightZoom.compareDocumentPosition(rightFit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: '왼쪽 높이맞춤' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '왼쪽 썸네일' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '오른쪽 높이맞춤' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '오른쪽 썸네일' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '폭맞춤' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '왼쪽 높이맞춤' }));
    expect(useViewer.getState().fit).toBe('height');
    fireEvent.click(screen.getByRole('button', { name: '왼쪽 썸네일' }));
    expect(useViewer.getState().thumbOpen).toBe(true);
    fireEvent.click(rightFit);
    expect(useSplit.getState().fit).toBe('width');
    fireEvent.click(screen.getByRole('button', { name: '오른쪽 썸네일' }));
    expect(useSplit.getState().thumbOpen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '오른쪽 PDF 닫기' }));
    expect(useSplit.getState().file).toBeNull();
    expect(screen.queryByText('비교')).toBeNull();
  });

  it('keeps a dragged split between 20 and 80 percent', () => {
    expect(splitRatioFromDrag(0.5, 100, 400)).toBe(0.75);
    expect(splitRatioFromDrag(0.5, 1000, 400)).toBe(0.8);
    expect(clampSplitRatio(-1)).toBe(0.2);
    expect(parsePdfDrag(pdfDragPayload(file))?.id).toBe('file-1');
    expect(parsePdfDrag('{}')).toBeNull();
  });
});
