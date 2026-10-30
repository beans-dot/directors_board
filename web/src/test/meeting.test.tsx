import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gasCall } from '../api/client';
import type { Profile } from '../api/types';
import { formatMeetingLabel } from '../domain/folderDate';
import { autoMeetingPlan, nextAutoRunKey } from '../domain/krHoliday';
import { AdminPage } from '../components/admin/AdminPage';
import { MeetingTab } from '../components/admin/MeetingTab';
import { LeftPanel } from '../components/layout/LeftPanel';
import { useAdmin } from '../state/admin';
import { useApp } from '../state/app';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, gasCall: vi.fn() };
});

const adminProfile: Profile = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  name: '관리자',
  position: '기획처',
  role: 'admin',
  adminToken: 'tok',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('meeting calendar', () => {
  beforeEach(() => {
    vi.mocked(gasCall).mockReset();
    vi.mocked(gasCall).mockReturnValue(new Promise(() => {}));
  });

  it('renders Sunday through Saturday and marks the saved day', () => {
    useAdmin.setState({
      settings: {
        rootFolderSet: true,
        rootFolderName: '자료',
        senderEmail: '',
        aliases: [],
        mailFromName: '',
        mailFromAlias: '',
        meetingDate: '2026-10-30',
        meetingTime: '09:00',
        dateFolders: [
          { folderDate: '26.10.30.', dateKey: '2026-10-30', folderId: 'abc', url: 'https://drive.google.com/drive/folders/abc' },
        ],
      },
    });
    render(<MeetingTab />);
    expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual(['일', '월', '화', '수', '목', '금', '토']);
    expect(screen.getByRole('gridcell', { selected: true }).getAttribute('aria-label')).toBe('2026-10-30, 자료 폴더 있음');
    expect(screen.getByRole('link', { name: 'Drive에서 자료 넣기' }).getAttribute('href')).toBe(
      'https://drive.google.com/drive/folders/abc',
    );
  });

  it('has no prefetch controls', () => {
    useAdmin.setState({ tab: 'meeting', settings: null });
    const admin = render(<AdminPage />);
    expect(screen.queryByRole('button', { name: '미리 받기 시간' })).toBeNull();
    expect(screen.getByRole('button', { name: '회의 일시' })).toBeTruthy();
    expect(screen.getByText(/보직을 고르기 전에도/)).toBeTruthy();
    expect(screen.getByText(/회의 10분 전부터 시작 1분 전까지 1분마다 자료/)).toBeTruthy();
    admin.unmount();

    render(<LeftPanel />);
    expect(screen.queryByText(/미리 받기/)).toBeNull();
    expect(screen.queryByRole('button', { name: '지금 받기' })).toBeNull();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeTruthy();
  });

  it('clears the saved meeting and leaves the date folder', async () => {
    useApp.setState({
      profile: adminProfile,
      config: {
        today: '26.10.30.',
        maxAttachBytes: 1,
        allowedRecipientDomain: 'yeonsung.ac.kr',
        meetingDate: '2026-10-30',
        meetingTime: '09:00',
      },
      toasts: [],
    });
    useAdmin.setState({
      settings: {
        rootFolderSet: true,
        rootFolderName: '자료',
        senderEmail: '',
        aliases: [],
        mailFromName: '',
        mailFromAlias: '',
        meetingDate: '2026-10-30',
        meetingTime: '09:00',
        dateFolders: [
          { folderDate: '26.10.30.', dateKey: '2026-10-30', folderId: 'abc', url: 'https://drive.google.com/drive/folders/abc' },
        ],
      },
    });
    vi.mocked(gasCall).mockResolvedValue({ meetingDate: '', meetingTime: '' });

    render(<MeetingTab />);
    fireEvent.click(screen.getByRole('button', { name: '회의 일시 삭제' }));

    await waitFor(() => expect(useAdmin.getState().settings?.meetingDate).toBe(''));
    expect(gasCall).toHaveBeenCalledWith(
      'setConfig',
      { clearMeeting: true },
      { deviceId: adminProfile.deviceId, adminToken: 'tok' },
    );
    expect(useApp.getState().config?.meetingDate).toBe('');
    expect(useApp.getState().config?.meetingTime).toBe('');
    expect(useAdmin.getState().settings?.dateFolders).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '회의 일시 삭제' })).toBeNull();
    expect(screen.getByText('아직 지정된 회의가 없습니다.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Drive에서 자료 넣기' })).toBeTruthy();
  });

  it('hides delete when no meeting is saved', () => {
    useAdmin.setState({
      settings: {
        rootFolderSet: true,
        rootFolderName: '자료',
        senderEmail: '',
        aliases: [],
        mailFromName: '',
        mailFromAlias: '',
        meetingDate: '',
        meetingTime: '',
        dateFolders: [],
      },
    });
    render(<MeetingTab />);
    expect(screen.queryByRole('button', { name: '회의 일시 삭제' })).toBeNull();
    expect(screen.getByText('아직 지정된 회의가 없습니다.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '자동생성' })).toBeNull();
  });

  it('turns automatic Monday creation on', async () => {
    useApp.setState({ profile: adminProfile, toasts: [] });
    useAdmin.setState({
      settings: {
        rootFolderSet: true,
        rootFolderName: '자료',
        senderEmail: '',
        aliases: [],
        mailFromName: '',
        mailFromAlias: '',
        meetingDate: '',
        meetingTime: '',
        meetingAuto: false,
        dateFolders: [],
      },
    });
    vi.mocked(gasCall).mockResolvedValue({ meetingAuto: true });
    render(<MeetingTab />);
    expect(screen.getByRole('button', { name: '자동생성' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '자동생성' }));
    await waitFor(() => expect(useAdmin.getState().settings?.meetingAuto).toBe(true));
    expect(gasCall).toHaveBeenCalledWith(
      'setConfig',
      { meetingAuto: true },
      { deviceId: adminProfile.deviceId, adminToken: 'tok' },
    );
    expect(screen.getByRole('button', { name: '자동생성' }).getAttribute('aria-pressed')).toBe('true');
    const runKey = nextAutoRunKey();
    const plan = autoMeetingPlan(runKey);
    const runLabel = formatMeetingLabel(runKey).replace(/^회의 /, '');
    const expected = plan
      ? `${runLabel} 오후 1시에 ${formatMeetingLabel(plan.dateKey, plan.time).replace(/^회의 /, '')} 회의와 자료 폴더를 만듭니다.`
      : `${runLabel} 오후 1시에는 다음 월요일이 휴일이라 만들지 않습니다.`;
    expect(screen.getByText(expected)).toBeTruthy();
  });
});
