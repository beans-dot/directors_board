import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Annotation } from '../api/types';
import { MemoListPanel } from '../components/memo/MemoListPanel';
import { listAnnotationsByFile, writeAnnotation } from '../db/annotations';
import { useApp } from '../state/app';
import { useMemoStore } from '../state/memo';

function pin(
  partial: Partial<Annotation> & Pick<Annotation, 'id' | 'content' | 'createdAt' | 'page'>,
): Annotation {
  return {
    driveFileId: 'file-1',
    path: '26.10.30./본문/a.pdf',
    folderDate: '26.10.30.',
    topFolder: '본문',
    x: 0.1,
    y: 0.2,
    w: 0.02,
    h: 0.02,
    type: 'pin',
    status: 'active',
    version: 1,
    updatedAt: partial.createdAt,
    ...partial,
  };
}

describe('memo list', () => {
  it('stays folded until the bookmark opens and closes the list', () => {
    useApp.setState({ memoOpen: false });
    useMemoStore.setState({
      items: [
        pin({ id: 'a', content: '접힌메모', page: 1, createdAt: '2026-10-30T01:00:00.000Z' }),
      ],
      activeId: null,
      editorId: null,
    });
    render(<MemoListPanel />);

    const bookmark = screen.getByRole('button', { name: '메모 보기' });
    expect(bookmark.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: '1 접힌메모' })).toBeNull();

    fireEvent.click(bookmark);
    expect(screen.getByRole('button', { name: '메모 접기' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: '1 접힌메모' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '메모 접기' }));
    expect(screen.getByRole('button', { name: '메모 보기' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByRole('button', { name: '1 접힌메모' })).toBeNull();
  });

  it('shows the same numbers as the page icons and deletes from the row', async () => {
    const later = pin({ id: 'b', content: '나중', page: 1, createdAt: '2026-10-30T02:00:00.000Z' });
    const earlier = pin({
      id: 'a',
      content: '먼저',
      page: 1,
      createdAt: '2026-10-30T01:00:00.000Z',
    });
    const secondPage = pin({
      id: 'c',
      content: '둘째쪽',
      page: 2,
      createdAt: '2026-10-30T00:00:00.000Z',
    });
    await writeAnnotation(earlier, 'create');
    await writeAnnotation(later, 'create');
    await writeAnnotation(secondPage, 'create');
    useApp.setState({ memoOpen: true });
    useMemoStore.setState({
      items: [later, earlier, secondPage],
      activeId: null,
      editorId: null,
    });
    render(<MemoListPanel />);

    const first = screen.getByRole('button', { name: '1 먼저' });
    const second = screen.getByRole('button', { name: '2 나중' });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 둘째쪽' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();

    const trash = screen.getAllByRole('button', { name: '메모 삭제' });
    expect(trash).toHaveLength(3);
    expect(first.compareDocumentPosition(trash[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(trash[0]);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '1 먼저' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: '1 나중' })).toBeTruthy();
    expect((await listAnnotationsByFile('file-1')).map((item) => item.id).sort()).toEqual(['b', 'c']);
  });

  it('shows every memo in the meeting folder under its file and can fold that file', () => {
    const here = pin({
      id: 'a',
      content: '본문메모',
      page: 1,
      createdAt: '2026-10-30T01:00:00.000Z',
    });
    const there = pin({
      id: 'b',
      content: '별첨메모',
      page: 3,
      createdAt: '2026-10-30T02:00:00.000Z',
      driveFileId: 'file-2',
      path: '26.10.30./별첨/예산.pdf',
    });
    useApp.setState({ memoOpen: true });
    useMemoStore.setState({
      items: [here, there],
      activeId: null,
      editorId: null,
    });
    render(<MemoListPanel />);

    expect(screen.getByRole('button', { name: 'a.pdf' })).toBeTruthy();
    const otherFile = screen.getByRole('button', { name: '예산.pdf' });
    expect(screen.getByRole('button', { name: '1 본문메모' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 별첨메모' })).toBeTruthy();

    fireEvent.click(otherFile);
    expect(screen.queryByRole('button', { name: '1 별첨메모' })).toBeNull();
    expect(screen.getByRole('button', { name: '1 본문메모' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '예산.pdf' }));
    expect(screen.getByRole('button', { name: '1 별첨메모' })).toBeTruthy();
  });
});
