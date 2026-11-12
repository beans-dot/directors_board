import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, DriveNode } from '../api/types';
import { PdfViewer } from '../components/viewer/PdfViewer';
import { clearFileMarks } from '../services/runtime';
import { useMemoStore } from '../state/memo';
import { useViewer } from '../state/viewer';

vi.mock('../services/runtime', async () => {
  const actual = await vi.importActual<typeof import('../services/runtime')>('../services/runtime');
  return { ...actual, clearFileMarks: vi.fn(async () => 2) };
});

const file: DriveNode = {
  id: 'file-1',
  name: '본문.pdf',
  kind: 'file',
  mimeType: 'application/pdf',
  isPdf: true,
  path: '26.10.30./본문/본문.pdf',
};

const ink: Annotation = {
  id: 'ink-1',
  driveFileId: 'file-1',
  path: file.path,
  folderDate: '26.10.30.',
  topFolder: '본문',
  page: 1,
  x: 0.1,
  y: 0.2,
  w: 0.2,
  h: 0.02,
  type: 'ink',
  content: '',
  status: 'active',
  version: 1,
  createdAt: '2026-10-30T01:00:00+09:00',
  updatedAt: '2026-10-30T01:00:00+09:00',
};

describe('clear marks button', () => {
  beforeEach(() => {
    vi.mocked(clearFileMarks).mockClear();
    useViewer.setState({ doc: null, file, local: null, loading: false, tool: 'select', readOnly: false });
    useMemoStore.setState({ items: [ink], activeId: null, editorId: null });
  });

  it('says the download keeps memos and marks', () => {
    render(<PdfViewer />);
    expect(screen.getByRole('button', { name: '이 자료 내려받기' }).getAttribute('title')).toBe(
      '메모, 필기 등이 함께 다운로드 됩니다',
    );
  });

  it('asks before clearing every mark except memos', async () => {
    render(<PdfViewer />);
    fireEvent.click(screen.getByRole('button', { name: '필기 모두 지우기' }));
    expect(screen.getByText('이 자료의 형광펜, 밑줄, 손글씨를 지웁니다. 메모는 남습니다.')).toBeTruthy();
    expect(clearFileMarks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    expect(clearFileMarks).toHaveBeenCalledWith('file-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
