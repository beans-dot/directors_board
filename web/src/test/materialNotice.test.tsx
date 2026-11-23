import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setMaterialChangeNotice } from '../api/materials';
import type { AdminSettings } from '../api/types';
import { MaterialsTab } from '../components/admin/MaterialsTab';
import { useAdmin } from '../state/admin';
import { useApp } from '../state/app';
import { useTree } from '../state/tree';

vi.mock('../api/materials', async () => ({
  ...await vi.importActual<typeof import('../api/materials')>('../api/materials'),
  setMaterialChangeNotice: vi.fn(),
}));

const notice = { fileId: 'f1', path: '26.11.23./별첨/[교무] 평가.pdf' };
const settings: AdminSettings = {
  rootFolderSet: true, rootFolderName: 'materials', senderEmail: '', aliases: [], mailFromName: '', mailFromAlias: '',
  meetings: [{ id: 'm1', dateKey: '2026-11-23', folderDate: '26.11.23.', time: '10:00', title: '보직회의',
    files: [{ id: 'f1', name: '[교무] 평가.pdf', category: '별첨', sortOrder: 1, size: 1000 }] }],
  changeNotices: [],
};

describe('material change notices', () => {
  beforeEach(() => {
    vi.mocked(setMaterialChangeNotice).mockReset();
    useAdmin.setState({ settings });
    useApp.setState({ toasts: [], profile: { role: 'admin', name: '관리자', position: '기획처', deviceId: 'd', createdAt: '' } });
    useTree.setState({ changeNotices: [] });
  });

  it('saves the per-file switch from the upload screen and shares the result with the viewer', async () => {
    vi.mocked(setMaterialChangeNotice).mockResolvedValue([notice]);
    render(<MaterialsTab />);
    const button = screen.getByRole('button', { name: '[교무] 평가.pdf 변경 알림' });
    fireEvent.click(button);
    expect(setMaterialChangeNotice).toHaveBeenCalledWith('f1', true);
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    expect(useTree.getState().changeNotices).toEqual([notice]);
    vi.mocked(setMaterialChangeNotice).mockResolvedValue([]);
    fireEvent.click(button);
    expect(setMaterialChangeNotice).toHaveBeenLastCalledWith('f1', false);
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
    expect(useTree.getState().changeNotices).toEqual([]);
  });

  it('keeps the saved switch state when a server request fails', async () => {
    vi.mocked(setMaterialChangeNotice).mockRejectedValue(new Error('저장하지 못했습니다.'));
    render(<MaterialsTab />);
    const button = screen.getByRole('button', { name: '[교무] 평가.pdf 변경 알림' });
    fireEvent.click(button);
    await waitFor(() => expect(useApp.getState().toasts.at(-1)?.text).toBe('저장하지 못했습니다.'));
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(useTree.getState().changeNotices).toEqual([]);
  });
});
