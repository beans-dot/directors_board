import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Annotation, DriveNode } from '../api/types';
import { MemoLayer } from '../components/memo/MemoLayer';
import { listAnnotationsByFile } from '../db/annotations';
import { useMemoStore } from '../state/memo';
import { useViewer } from '../state/viewer';

const file: DriveNode = {
  id: 'file-1',
  name: '본문.pdf',
  kind: 'file',
  mimeType: 'application/pdf',
  isPdf: true,
  path: '26.11.09./본문/1_샘플.pdf',
};

function pin(content = ''): Annotation {
  return {
    id: 'pin-1',
    driveFileId: file.id,
    path: file.path,
    folderDate: '26.11.09.',
    topFolder: '본문',
    page: 1,
    x: 0.4,
    y: 0.3,
    w: 0.02,
    h: 0.02,
    type: 'pin',
    content,
    status: 'active',
    version: 1,
    createdAt: '2026-11-09T01:00:00.000Z',
    updatedAt: '2026-11-09T01:00:00.000Z',
  };
}

describe('memo editor', () => {
  beforeEach(() => {
    useViewer.setState({ file, tool: 'select', readOnly: false, color: 'yellow' });
    useMemoStore.setState({ items: [pin()], activeId: 'pin-1', editorId: 'pin-1' });
  });

  it('saves the typed text and closes when the page outside the memo is clicked', async () => {
    render(<MemoLayer page={1} rotate={0} width={400} height={600} />);
    fireEvent.change(screen.getByRole('textbox', { name: '메모' }), { target: { value: '회의 결론입니다' } });
    fireEvent.pointerDown(document.body);

    expect(useMemoStore.getState().editorId).toBeNull();
    await waitFor(async () => {
      const saved = await listAnnotationsByFile(file.id);
      expect(saved.find((item) => item.id === 'pin-1')?.content).toBe('회의 결론입니다');
    });
  });

  it('deletes the memo from the open card', async () => {
    render(<MemoLayer page={1} rotate={0} width={400} height={600} />);
    fireEvent.click(screen.getByRole('button', { name: '메모 삭제' }));
    await waitFor(() => {
      expect(useMemoStore.getState().editorId).toBeNull();
      expect(useMemoStore.getState().items.some((item) => item.id === 'pin-1' && item.status === 'active')).toBe(false);
    });
    const saved = await listAnnotationsByFile(file.id);
    expect(saved.some((item) => item.id === 'pin-1')).toBe(false);
  });

  it('stays open when the click is inside the memo', () => {
    render(<MemoLayer page={1} rotate={0} width={400} height={600} />);
    fireEvent.pointerDown(screen.getByRole('textbox', { name: '메모' }));
    expect(useMemoStore.getState().editorId).toBe('pin-1');
    expect(screen.getByRole('textbox', { name: '메모' })).toBeTruthy();
  });
});
