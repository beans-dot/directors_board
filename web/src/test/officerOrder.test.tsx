import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listLoginLocks, saveOfficers } from '../api/materials';
import type { Officer } from '../api/types';
import { OfficersTab } from '../components/admin/OfficersTab';
import { useAdmin } from '../state/admin';
import { useApp } from '../state/app';

vi.mock('../api/materials', async () => {
  const actual = await vi.importActual<typeof import('../api/materials')>('../api/materials');
  return {
    ...actual,
    listLoginLocks: vi.fn(),
    clearLoginLock: vi.fn(),
    saveOfficers: vi.fn(),
    resetOfficerPassword: vi.fn(),
  };
});

const kim: Officer = {
  id: 'user_order_kim',
  position: '기획처장',
  name: '김민수',
  email: 'kim.order@yeonsung.ac.kr',
  employeeNo: '20241111',
};

const lee: Officer = {
  id: 'user_order_lee',
  position: '교무처장',
  name: '이서연',
  email: 'lee.order@yeonsung.ac.kr',
  employeeNo: '20242222',
};

describe('officer order', () => {
  beforeEach(() => {
    vi.mocked(listLoginLocks).mockResolvedValue([]);
    vi.mocked(saveOfficers).mockResolvedValue([lee, kim]);
    useApp.setState({ profile: { role: 'admin', name: '관리자', position: '기획처', deviceId: 'd', createdAt: '2026-01-01T00:00:00.000Z' }, toasts: [] });
    useAdmin.setState({
      settings: {
        rootFolderSet: true,
        rootFolderName: 'materials',
        senderEmail: '',
        aliases: [],
        mailFromName: '',
        mailFromAlias: '',
        officers: [kim, lee],
        meetingDate: '',
        meetingTime: '',
        meetingAuto: false,
        meetingAutoWeekday: 1,
        meetingAutoTime: '13:00',
        dateFolders: [],
        meetings: [],
        usageTips: [],
      },
    });
  });

  it('drops an officer into a new place and saves that order', async () => {
    render(<OfficersTab />);
    await waitFor(() => expect(screen.getByText('잠긴 로그인이 없습니다.')).toBeTruthy());
    const leeGrip = screen.getByRole('button', { name: '교무처장 이서연 순서 바꾸기' });
    const kimRow = screen.getByRole('button', { name: '기획처장 김민수 순서 바꾸기' }).parentElement;
    if (!kimRow) throw new Error('row missing');
    fireEvent.dragStart(leeGrip, { dataTransfer: { effectAllowed: 'move', setData() {} } });
    fireEvent.drop(kimRow);
    const positions = screen.getAllByLabelText('직위').map((input) => (input as HTMLInputElement).value);
    expect(positions).toEqual(['교무처장', '기획처장']);
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(saveOfficers).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'user_order_lee' }),
        expect.objectContaining({ id: 'user_order_kim' }),
      ]),
    );
  });
});
