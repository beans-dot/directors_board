import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DriveNode, LocalFile, Profile } from '../api/types';
import { TreeNode } from '../components/tree/TreeNode';
import { PdfViewer } from '../components/viewer/PdfViewer';
import { changeNoticeMatches, normalizeChangeNotices, showFileChangeAlert, showPdfVersionHistory } from '../domain/changeNotice';
import { pdfVersionLabel } from '../domain/pdfVersion';
import { useApp } from '../state/app';
import { useTree } from '../state/tree';
import { useViewer } from '../state/viewer';

const admin: Profile = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  name: '관리자',
  position: '기획처',
  role: 'admin',
  adminToken: 'tok',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const user: Profile = { ...admin, name: '김보직', role: 'user', adminToken: undefined };

const file: DriveNode = {
  id: 'f1',
  name: '예산.pdf',
  kind: 'file',
  mimeType: 'application/pdf',
  isPdf: true,
  path: '26.11.02./별첨/예산.pdf',
};

const local: LocalFile = {
  driveFileId: 'f1',
  path: file.path,
  folderDate: '26.11.02.',
  topFolder: '별첨',
  name: '예산.pdf',
  modifiedTime: '2026-11-02T01:00:00.000Z',
  versions: [
    {
      blobKey: 'old',
      modifiedTime: '2026-11-01T00:00:00.000Z',
      replacedAt: '2026-11-02T00:24:00.000Z',
      driveFileId: 'old-id',
    },
  ],
};

describe('change notices', () => {
  beforeEach(() => {
    useApp.setState({ profile: null, toasts: [] });
    useTree.setState({ changeNotices: [], selectedId: null });
    useViewer.setState({ file: null, local: null, doc: null, loading: false, viewingKey: '', readOnly: false });
  });

  it('matches a replaced file by path and ignores unrelated files', () => {
    const notices = normalizeChangeNotices([
      { fileId: 'old-id', path: file.path },
      { fileId: '', path: 'x' },
      null,
    ]);
    expect(notices).toEqual([{ fileId: 'old-id', path: file.path }]);
    expect(changeNoticeMatches(notices, { id: 'new-id', path: file.path })).toBe(true);
    expect(showPdfVersionHistory({ role: 'user', notices, file, versionCount: 1 })).toBe(true);
    expect(showPdfVersionHistory({ role: 'user', notices: [], file, versionCount: 1 })).toBe(false);
    expect(showPdfVersionHistory({ role: 'admin', notices: [], file, versionCount: 1 })).toBe(true);
    expect(showPdfVersionHistory({ role: 'user', notices, file, versionCount: 0 })).toBe(false);
    expect(showFileChangeAlert('admin')).toBe(true);
    expect(showFileChangeAlert('user')).toBe(false);
    expect(showFileChangeAlert(undefined)).toBe(false);
    expect(pdfVersionLabel('2026-11-02T00:24:00.000Z')).toBe('이전 2026-11-02 09:24');
  });

  it('hides version history from users until that file is marked', () => {
    useViewer.setState({ file, local, doc: null, loading: false, viewingKey: '' });
    useApp.setState({ profile: user });
    const hidden = render(<PdfViewer />);
    expect(screen.queryByRole('combobox', { name: '버전' })).toBeNull();
    hidden.unmount();

    useTree.setState({ changeNotices: [{ fileId: 'other', path: '26.11.02./본문/다른.pdf' }] });
    const other = render(<PdfViewer />);
    expect(screen.queryByRole('combobox', { name: '버전' })).toBeNull();
    other.unmount();

    useTree.setState({ changeNotices: [{ fileId: 'old-id', path: file.path }] });
    render(<PdfViewer />);
    const versions = screen.getByRole('combobox', { name: '버전' });
    expect(versions).toBeTruthy();
    expect(screen.getByRole('option', { name: '현재 버전' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '이전 2026-11-02 09:24' })).toBeTruthy();
  });

  it('shows the 바뀜 mark only to admin', () => {
    useTree.setState({ replacedIds: [file.id] });
    useApp.setState({ profile: user, replaceNotice: '자료가 바뀌었음 — 별첨/예산.pdf. 기존 메모를 같은 위치로 옮겼습니다.' });
    const asUser = render(<TreeNode node={file} depth={2} />);
    expect(screen.queryByText('바뀜')).toBeNull();
    asUser.unmount();

    useApp.setState({ profile: admin });
    render(<TreeNode node={file} depth={2} />);
    expect(screen.getByText('바뀜')).toBeTruthy();
  });

  it('lets only admin open 설정 and turn on 변경알림 for one file', async () => {
    useApp.setState({ profile: user });
    const asUser = render(<TreeNode node={file} depth={2} />);
    expect(screen.queryByRole('button', { name: '예산 설정' })).toBeNull();
    asUser.unmount();

    useApp.setState({ profile: admin, toasts: [] });
    render(<TreeNode node={file} depth={2} />);
    fireEvent.click(screen.getByRole('button', { name: '예산 설정' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '변경알림' }));

    await waitFor(() => {
      expect(useTree.getState().changeNotices).toEqual([{ fileId: 'f1', path: file.path }]);
      expect(screen.queryByRole('menuitem')).toBeNull();
    });
    expect(useApp.getState().toasts.some((item) => item.text.includes('변경 표시를 이 화면에 남겼습니다'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '예산 설정' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '변경알림 해제' }));
    await waitFor(() => {
      expect(useTree.getState().changeNotices).toEqual([]);
    });
  });
});
