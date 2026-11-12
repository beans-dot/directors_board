import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAdminAccount, logoutSession } from '../api/materials';
import type { Profile } from '../api/types';
import { Header } from '../components/layout/Header';
import { saveProfile } from '../db/profile';
import { loginAdmin, logoutAdmin } from '../services/runtime';
import { useApp } from '../state/app';

vi.mock('../api/materials', async () => {
  const actual = await vi.importActual<typeof import('../api/materials')>('../api/materials');
  return { ...actual, loginAdminAccount: vi.fn(), logoutSession: vi.fn(), fetchRoster: vi.fn().mockResolvedValue([]) };
});

const officer: Profile = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  name: '김민수',
  position: '기획처장',
  role: 'user',
  officerId: 'officer-1',
  savedEmail: 'kim@ysu.ac.kr',
  createdAt: '2026-01-01T00:00:00.000Z',
  registeredAt: '2026-01-01T00:00:00.000Z',
};

describe('admin account', () => {
  beforeEach(() => {
    vi.mocked(loginAdminAccount).mockReset();
    vi.mocked(logoutSession).mockReset();
    useApp.setState({
      profile: null,
      showOnboarding: false,
      showAdminConvert: false,
      menuOpen: false,
      screen: 'main',
      toasts: [],
    });
  });

  it('shows 기획처. 관리자 and drops the officer session', async () => {
    useApp.setState({ profile: officer, menuOpen: true });
    await saveProfile(officer);
    vi.mocked(loginAdminAccount).mockResolvedValue({
      userId: 'admin',
      name: '관리자',
      position: '기획처',
      role: 'admin',
      mustChangePassword: false,
    });

    await loginAdmin('secret');

    const next = useApp.getState().profile;
    expect(next?.name).toBe('관리자');
    expect(next?.position).toBe('기획처');
    expect(next?.role).toBe('admin');
    expect(next?.officerId).toBeUndefined();
    expect(next?.savedEmail).toBeUndefined();
    expect(next?.adminToken).toBe('session');
    expect(useApp.getState().menuOpen).toBe(false);

    useApp.setState({ menuOpen: true });
    render(<Header />);
    const label = screen.getByRole('button', { name: '기획처. 관리자' });
    const manage = screen.getByRole('button', { name: '관리' });
    const refresh = screen.getByRole('button', { name: '전체새로고침' });
    expect(manage.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: '보직 다시 선택' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'admin으로 변환' })).toBeNull();
    expect(screen.queryByRole('button', { name: '메모 백업' })).toBeNull();
    expect(screen.queryByRole('button', { name: '저장공간 정보' })).toBeNull();
    expect(screen.queryByRole('button', { name: '관리자 해제' })).toBeNull();
    fireEvent.click(label);
    expect(screen.getByRole('menuitem', { name: '비밀번호 변경' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '로그아웃' })).toBeTruthy();
  });

  it('keeps the officer signed in when the admin password is wrong', async () => {
    useApp.setState({ profile: officer });
    await saveProfile(officer);
    vi.mocked(loginAdminAccount).mockRejectedValue(new Error('비밀번호가 올바르지 않습니다.'));

    await expect(loginAdmin('nope')).rejects.toThrow('비밀번호가 올바르지 않습니다.');
    expect(useApp.getState().profile).toMatchObject({ name: '김민수', position: '기획처장', officerId: 'officer-1', role: 'user' });
  });

  it('returns to the login screen when admin is released', async () => {
    useApp.setState({
      profile: { ...officer, name: '관리자', position: '기획처', role: 'admin', officerId: undefined, savedEmail: undefined, adminToken: 'tok' },
      screen: 'admin',
      menuOpen: true,
    });

    await logoutAdmin();

    expect(useApp.getState().profile).toBeNull();
    expect(useApp.getState().showOnboarding).toBe(true);
    expect(useApp.getState().screen).toBe('main');
    expect(useApp.getState().menuOpen).toBe(false);
  });

  it('shows an officer as position and name', async () => {
    useApp.setState({ profile: officer, menuOpen: true });
    render(<Header />);
    expect(screen.getByRole('button', { name: '기획처장. 김민수' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '전체새로고침' })).toBeNull();
    expect(screen.queryByRole('button', { name: '보직 다시 선택' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'admin으로 변환' })).toBeNull();
    expect(screen.queryByRole('button', { name: '메모 백업' })).toBeNull();
    expect(screen.queryByRole('button', { name: '저장공간 정보' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '비밀번호 변경' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '기획처장. 김민수' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '비밀번호 변경' }));
    expect(useApp.getState().showPassword).toBe(true);
    expect(useApp.getState().passwordRequired).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '기획처장. 김민수' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }));
    await waitFor(() => expect(useApp.getState().profile).toBeNull());
    expect(useApp.getState().showOnboarding).toBe(true);
  });

  it('opens the user screen from the title when the account is admin', () => {
    useApp.setState({
      profile: { ...officer, name: '관리자', position: '기획처', role: 'admin', officerId: undefined },
      screen: 'admin',
    });
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, reload } });
    try {
      render(<Header />);
      fireEvent.click(screen.getByRole('button', { name: '보직회의 지원 시스템' }));
      expect(reload).not.toHaveBeenCalled();
      expect(useApp.getState().screen).toBe('main');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
  });

  it('reloads the app from the title', () => {
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, reload } });
    try {
      render(<Header />);
      fireEvent.click(screen.getByRole('button', { name: '보직회의 지원 시스템' }));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
  });
});
