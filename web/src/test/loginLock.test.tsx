import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLoginLock, listLoginLocks } from '../api/materials';
import type { LoginLock } from '../api/types';
import { OfficersTab } from '../components/admin/OfficersTab';
import { useAdmin } from '../state/admin';
import { useApp } from '../state/app';

vi.mock('../api/materials', async () => {
  const actual = await vi.importActual<typeof import('../api/materials')>('../api/materials');
  return { ...actual, listLoginLocks: vi.fn(), clearLoginLock: vi.fn(), saveOfficers: vi.fn(), resetOfficerPassword: vi.fn() };
});

const account: LoginLock = {
  key: 'user:user_lock3333',
  kind: 'account',
  name: '김민수',
  position: '기획처장',
  lockedUntil: Date.now() + 12 * 60 * 1000,
};

const address: LoginLock = {
  key: 'ip:10.0.0.8',
  kind: 'address',
  name: '10.0.0.8',
  position: '',
  lockedUntil: Date.now() + 8 * 60 * 1000,
};

describe('login lock admin', () => {
  beforeEach(() => {
    vi.mocked(listLoginLocks).mockReset();
    vi.mocked(clearLoginLock).mockReset();
    useApp.setState({ profile: null, toasts: [] });
    useAdmin.setState({
      settings: {
        rootFolderSet: true,
        rootFolderName: 'materials',
        senderEmail: '',
        aliases: [],
        mailFromName: '',
        mailFromAlias: '',
        officers: [],
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

  it('shows a locked account and address, then clears the account', async () => {
    vi.mocked(listLoginLocks).mockResolvedValue([account, address]);
    vi.mocked(clearLoginLock).mockResolvedValue([address]);
    render(<OfficersTab />);
    expect(await screen.findByText('기획처장 김민수')).toBeTruthy();
    expect(screen.getByText('접속 주소 10.0.0.8')).toBeTruthy();
    expect(screen.getByText('12분 남음')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '기획처장 김민수 잠금 해제' }));
    await waitFor(() => expect(clearLoginLock).toHaveBeenCalledWith('user:user_lock3333'));
    await waitFor(() => expect(screen.queryByText('기획처장 김민수')).toBeNull());
    expect(screen.getByText('접속 주소 10.0.0.8')).toBeTruthy();
    expect(useApp.getState().toasts.some((item) => item.text.includes('기획처장 김민수 잠금을 풀었습니다.'))).toBe(true);
  });

  it('says there is no login lock', async () => {
    vi.mocked(listLoginLocks).mockResolvedValue([]);
    render(<OfficersTab />);
    expect(await screen.findByText('잠긴 로그인이 없습니다.')).toBeTruthy();
  });
});
