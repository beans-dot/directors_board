import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMaterialFolder,
  deleteMaterialFolder,
  loadAdminHome,
  reorderMaterialFiles,
  requestMaterialRefresh,
  saveMaterialMeeting,
} from '../api/materials';
import type { Profile } from '../api/types';
import { formatMeetingLabel } from '../domain/folderDate';
import { autoMeetingPlan, nextAutoRunKey } from '../domain/krHoliday';
import { AdminPage } from '../components/admin/AdminPage';
import { MaterialsTab } from '../components/admin/MaterialsTab';
import { MeetingTab } from '../components/admin/MeetingTab';
import { Header } from '../components/layout/Header';
import { LeftPanel } from '../components/layout/LeftPanel';
import { refreshTree } from '../services/runtime';
import { useAdmin } from '../state/admin';
import { useApp } from '../state/app';

vi.mock('../services/runtime', async () => {
  const actual = await vi.importActual<typeof import('../services/runtime')>('../services/runtime');
  return { ...actual, refreshTree: vi.fn(actual.refreshTree) };
});

vi.mock('../api/materials', async () => {
  const actual = await vi.importActual<typeof import('../api/materials')>('../api/materials');
  return {
    ...actual,
    saveMaterialMeeting: vi.fn(),
    createMaterialFolder: vi.fn(),
    deleteMaterialFolder: vi.fn(),
    loadAdminHome: vi.fn(),
    reorderMaterialFiles: vi.fn(),
    requestMaterialRefresh: vi.fn(),
    listMaterialFolders: vi.fn().mockResolvedValue(null),
    bootFromServer: vi
      .fn()
      .mockRejectedValue(new Error('서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.')),
  };
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
    vi.mocked(saveMaterialMeeting).mockReset();
    vi.mocked(requestMaterialRefresh).mockReset();
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
          {
            folderDate: '26.10.30.',
            dateKey: '2026-10-30',
            folderId: 'abc',
            url: 'https://drive.google.com/drive/folders/abc',
          },
        ],
      },
    });
    render(<MeetingTab />);
    expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
      '일',
      '월',
      '화',
      '수',
      '목',
      '금',
      '토',
    ]);
    expect(screen.getByRole('gridcell', { selected: true }).getAttribute('aria-label')).toBe(
      '2026-10-30, 자료 폴더 있음',
    );
    expect(screen.queryByLabelText('본문에 PDF 올리기')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Drive에서 자료 넣기' })).toBeNull();
    expect((screen.getByRole('textbox', { name: '회의 이름' }) as HTMLInputElement).value).toBe(
      '보직회의',
    );
  });

  it('lists each PDF under its 본문, 별첨, or 규정 column', () => {
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
        dateFolders: [{ folderDate: '26.10.30.', dateKey: '2026-10-30', folderId: 'abc', url: '' }],
        meetings: [
          {
            id: 'm1',
            dateKey: '2026-10-30',
            folderDate: '26.10.30.',
            time: '09:00',
            title: '확대간부회의',
            files: [
              { id: 'f1', name: '예산안.pdf', category: '본문', sortOrder: 1, size: 1200 },
              { id: 'f2', name: '학칙.pdf', category: '규정', sortOrder: 1, size: 800 },
            ],
          },
        ],
      },
    });
    render(<MaterialsTab />);
    expect((screen.getByLabelText('자료 폴더') as HTMLSelectElement).value).toBe('2026-10-30');
    const body = screen.getByRole('region', { name: '본문' });
    const rules = screen.getByRole('region', { name: '규정' });
    expect(within(body).getByText('예산안.pdf')).toBeTruthy();
    expect(within(body).queryByText('학칙.pdf')).toBeNull();
    expect(within(rules).getByText('학칙.pdf')).toBeTruthy();
    expect(within(body).queryByRole('button', { name: '예산안.pdf 위로' })).toBeNull();
    expect(within(body).getByLabelText('예산안.pdf 변경')).toBeTruthy();
    expect(within(body).getByRole('button', { name: '예산안.pdf 삭제' })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: '별첨' })).getByText('올린 자료가 없습니다.'),
    ).toBeTruthy();
  });

  it('reorders a bucket by dragging a file onto another', async () => {
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
        dateFolders: [{ folderDate: '26.10.30.', dateKey: '2026-10-30', folderId: 'abc', url: '' }],
        meetings: [
          {
            id: 'm1',
            dateKey: '2026-10-30',
            folderDate: '26.10.30.',
            time: '09:00',
            title: '확대간부회의',
            files: [
              { id: 'f1', name: '예산안.pdf', category: '본문', sortOrder: 1, size: 1200 },
              { id: 'f2', name: '안건.pdf', category: '본문', sortOrder: 2, size: 900 },
            ],
          },
        ],
      },
    });
    vi.mocked(reorderMaterialFiles).mockResolvedValue();
    vi.mocked(loadAdminHome).mockResolvedValue({
      settings: useAdmin.getState().settings!,
      devices: [],
      access: [],
    });
    render(<MaterialsTab />);
    const source = screen.getByText('예산안.pdf').closest('li');
    const target = screen.getByText('안건.pdf').closest('li');
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    fireEvent.dragStart(source!);
    fireEvent.drop(target!);
    await waitFor(() => expect(reorderMaterialFiles).toHaveBeenCalledWith(['f2', 'f1']));
  });

  it('switches the upload target when another date folder is chosen', () => {
    useAdmin.setState({
      tab: 'materials',
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
          { folderDate: '26.10.30.', dateKey: '2026-10-30', folderId: 'abc', url: '' },
          { folderDate: '26.11.12.', dateKey: '2026-11-12', folderId: 'def', url: '' },
        ],
        meetings: [
          {
            id: 'm1',
            dateKey: '2026-10-30',
            folderDate: '26.10.30.',
            time: '09:00',
            title: '확대간부회의',
            files: [{ id: 'f1', name: '예산안.pdf', category: '본문', sortOrder: 1, size: 1200 }],
          },
          {
            id: 'm2',
            dateKey: '2026-11-12',
            folderDate: '26.11.12.',
            time: '10:00',
            title: '보직회의',
            files: [{ id: 'f2', name: '학칙.pdf', category: '규정', sortOrder: 1, size: 800 }],
          },
        ],
      },
    });
    render(<AdminPage />);
    expect(screen.getByRole('heading', { name: '회의자료관리' })).toBeTruthy();
    expect(screen.queryByRole('grid', { name: '보직회의 날짜' })).toBeNull();
    const folder = screen.getByLabelText('자료 폴더') as HTMLSelectElement;
    expect(folder.value).toBe('2026-10-30');
    expect(screen.getByText('예산안.pdf')).toBeTruthy();
    fireEvent.change(folder, { target: { value: '2026-11-12' } });
    expect(screen.queryByText('예산안.pdf')).toBeNull();
    expect(within(screen.getByRole('region', { name: '규정' })).getByText('학칙.pdf')).toBeTruthy();
    expect(screen.getByLabelText('본문에 PDF 올리기')).toBeTruthy();
  });

  it('creates a date folder from a typed date without changing the current meeting', async () => {
    useApp.setState({ profile: adminProfile, toasts: [] });
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
        dateFolders: [{ folderDate: '26.10.30.', dateKey: '2026-10-30', folderId: 'abc', url: '' }],
        meetings: [],
      },
    });
    vi.mocked(createMaterialFolder).mockResolvedValue({
      folderDate: '26.12.01.',
      dateKey: '2026-12-01',
      folderId: 'new',
      url: '',
    });
    vi.mocked(loadAdminHome).mockResolvedValue({
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
          { folderDate: '26.10.30.', dateKey: '2026-10-30', folderId: 'abc', url: '' },
          { folderDate: '26.12.01.', dateKey: '2026-12-01', folderId: 'new', url: '' },
        ],
        meetings: [],
      },
      devices: [],
      access: [],
    });
    render(<MaterialsTab />);
    fireEvent.change(screen.getByLabelText('새 자료 폴더 날짜'), {
      target: { value: '2026.12.01.' },
    });
    fireEvent.click(screen.getByRole('button', { name: '폴더 만들기' }));
    await waitFor(() =>
      expect(createMaterialFolder).toHaveBeenCalledWith('2026-12-01', '10:00', '보직회의', {
        folderOnly: true,
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('자료 폴더') as HTMLSelectElement).value).toBe('2026-12-01'),
    );
    expect(
      useApp.getState().toasts.some((item) => item.text.includes('26.12.01. 폴더를 만들었습니다')),
    ).toBe(true);
  });

  it('deletes the selected date folder after a second confirmation', async () => {
    useApp.setState({ profile: adminProfile, toasts: [] });
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
          { folderDate: '26.10.30.', dateKey: '2026-10-30', folderId: 'abc', url: '' },
          { folderDate: '26.11.12.', dateKey: '2026-11-12', folderId: 'm2', url: '' },
        ],
        meetings: [
          {
            id: 'abc',
            dateKey: '2026-10-30',
            folderDate: '26.10.30.',
            time: '09:00',
            title: '확대간부회의',
            files: [{ id: 'f1', name: '예산안.pdf', category: '본문', sortOrder: 1, size: 1200 }],
          },
          {
            id: 'm2',
            dateKey: '2026-11-12',
            folderDate: '26.11.12.',
            time: '10:00',
            title: '보직회의',
            files: [],
          },
        ],
      },
    });
    vi.mocked(deleteMaterialFolder).mockResolvedValue({
      folderDate: '26.10.30.',
      dateKey: '2026-10-30',
      clearedSchedule: true,
      memosKept: true,
    });
    vi.mocked(loadAdminHome).mockResolvedValue({
      settings: {
        rootFolderSet: true,
        rootFolderName: '자료',
        senderEmail: '',
        aliases: [],
        mailFromName: '',
        mailFromAlias: '',
        meetingDate: '',
        meetingTime: '',
        dateFolders: [{ folderDate: '26.11.12.', dateKey: '2026-11-12', folderId: 'm2', url: '' }],
        meetings: [
          {
            id: 'm2',
            dateKey: '2026-11-12',
            folderDate: '26.11.12.',
            time: '10:00',
            title: '보직회의',
            files: [],
          },
        ],
      },
      devices: [],
      access: [],
    });
    vi.mocked(refreshTree).mockResolvedValueOnce(true);
    render(<MaterialsTab />);
    fireEvent.click(screen.getByRole('button', { name: '이 폴더 삭제' }));
    expect(screen.getByText(/26\.10\.30\. 폴더와 그 안의 PDF를 지웁니다/)).toBeTruthy();
    expect(screen.getByText(/회의 일시도 해제됩니다/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(deleteMaterialFolder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '이 폴더 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    await waitFor(() => expect(deleteMaterialFolder).toHaveBeenCalledWith('2026-10-30'));
    await waitFor(() =>
      expect((screen.getByLabelText('자료 폴더') as HTMLSelectElement).value).toBe('2026-11-12'),
    );
    expect(screen.queryByRole('option', { name: '26.10.30.' })).toBeNull();
    expect(
      useApp
        .getState()
        .toasts.some((item) =>
          item.text.includes(
            '26.10.30. 폴더를 삭제하고, 그 날짜로 잡혀 있던 회의 일시도 해제했습니다',
          ),
        ),
    ).toBe(true);
  });

  it('has no prefetch controls', () => {
    useAdmin.setState({ tab: 'meeting', settings: null });
    const admin = render(<AdminPage />);
    expect(screen.getByRole('heading', { name: '회의자료관리' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '회의자료관리' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: '미리 받기 시간' })).toBeNull();
    expect(screen.queryByRole('button', { name: '뒤로가기' })).toBeNull();
    const menu = screen.getByRole('navigation', { name: '관리 메뉴' });
    const labels = within(menu).getAllByRole('button').map((button) => button.textContent);
    expect(labels).toEqual(['회의자료관리', '회의 일시', '접속 현황', '보직자', '사용 Tip']);
    expect(screen.getByText(/보직을 고르기 전에도/)).toBeTruthy();
    expect(screen.getByText(/메인 화면의 전체새로고침은 지금 열어 둔 화면/)).toBeTruthy();
    expect(screen.getByText(/회의 시작 전 자동 확인은 하지 않습니다/)).toBeTruthy();
    expect(screen.getByText(/약 30초 안에 목록을 다시 받습니다/)).toBeTruthy();
    admin.unmount();

    render(<LeftPanel />);
    expect(screen.queryByText(/미리 받기/)).toBeNull();
    expect(screen.queryByRole('button', { name: '지금 받기' })).toBeNull();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeTruthy();
  });

  it('asks every open screen to refresh the folder', async () => {
    useApp.setState({ profile: adminProfile, toasts: [] });
    vi.mocked(requestMaterialRefresh).mockResolvedValue({
      treeRefreshAt: '2026-11-02T09:04:00+09:00',
    });
    render(<Header />);
    const manage = screen.getByRole('button', { name: '관리' });
    const refresh = screen.getByRole('button', { name: '전체새로고침' });
    expect(manage.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(refresh);
    await waitFor(() => expect(requestMaterialRefresh).toHaveBeenCalled());
    expect(
      useApp.getState().toasts.some((item) => item.text.includes('자료 새로고침을 요청')),
    ).toBe(true);
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
          {
            folderDate: '26.10.30.',
            dateKey: '2026-10-30',
            folderId: 'abc',
            url: 'https://drive.google.com/drive/folders/abc',
          },
        ],
      },
    });
    vi.mocked(saveMaterialMeeting).mockResolvedValue({
      meetingDate: '',
      meetingTime: '',
      meetingAuto: false,
    });

    render(<MeetingTab />);
    fireEvent.click(screen.getByRole('button', { name: '회의 일시 삭제' }));

    await waitFor(() => expect(useAdmin.getState().settings?.meetingDate).toBe(''));
    expect(saveMaterialMeeting).toHaveBeenCalledWith({ clearMeeting: true });
    expect(useApp.getState().config?.meetingDate).toBe('');
    expect(useApp.getState().config?.meetingTime).toBe('');
    expect(useAdmin.getState().settings?.dateFolders).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '회의 일시 삭제' })).toBeNull();
    expect(screen.getByText('아직 지정된 회의가 없습니다.')).toBeTruthy();
    expect(screen.queryByLabelText('본문에 PDF 올리기')).toBeNull();
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
    expect(screen.queryByLabelText('자료 폴더')).toBeNull();
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
    vi.mocked(saveMaterialMeeting).mockResolvedValue({
      meetingDate: '',
      meetingTime: '',
      meetingAuto: true,
    });
    render(<MeetingTab />);
    expect(screen.getByRole('button', { name: '자동생성' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: '자동생성' }));
    await waitFor(() => expect(useAdmin.getState().settings?.meetingAuto).toBe(true));
    expect(saveMaterialMeeting).toHaveBeenCalledWith({
      meetingAuto: true,
      meetingAutoWeekday: 1,
      meetingAutoTime: '10:00',
    });
    expect(screen.getByRole('button', { name: '자동생성' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const runKey = nextAutoRunKey();
    const plan = autoMeetingPlan(runKey);
    const runLabel = formatMeetingLabel(runKey).replace(/^회의 /, '');
    const expected = plan
      ? `${runLabel} 오후 1시에 ${formatMeetingLabel(plan.dateKey, plan.time).replace(/^회의 /, '')} 회의와 자료 폴더를 만듭니다.`
      : `${runLabel} 오후 1시에는 다음 월요일이 휴일이라 만들지 않습니다.`;
    expect(screen.getByText(expected)).toBeTruthy();
  });
});
