import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GasError, gasCall } from '../api/client';
import type { Profile } from '../api/types';
import { Header } from '../components/layout/Header';
import { saveProfile } from '../db/profile';
import { loginAdmin, logoutAdmin } from '../services/runtime';
import { useApp } from '../state/app';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, gasCall: vi.fn() };
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
    vi.mocked(gasCall).mockReset();
    useApp.setState({
      profile: null,
      showOnboarding: false,
      showAdminConvert: false,
      menuOpen: false,
      screen: 'main',
      toasts: [],
    });
  });

  it('shows 관리자. 기획처 and drops the officer session', async () => {
    useApp.setState({ profile: officer, menuOpen: true });
    await saveProfile(officer);
    vi.mocked(gasCall).mockResolvedValue({ adminToken: 'tok', exp: 99 });

    await loginAdmin('secret');

    const next = useApp.getState().profile;
    expect(next?.name).toBe('관리자');
    expect(next?.position).toBe('기획처');
    expect(next?.role).toBe('admin');
    expect(next?.officerId).toBeUndefined();
    expect(next?.savedEmail).toBeUndefined();
    expect(next?.adminToken).toBe('tok');
    expect(useApp.getState().menuOpen).toBe(false);

    useApp.setState({ menuOpen: true });
    render(<Header />);
    expect(screen.getByRole('button', { name: '관리자. 기획처' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '보직 다시 선택' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'admin으로 변환' })).toBeNull();
    expect(screen.getByRole('button', { name: '관리자 해제' })).toBeTruthy();
  });

  it('keeps the officer signed in when the admin password is wrong', async () => {
    useApp.setState({ profile: officer });
    await saveProfile(officer);
    vi.mocked(gasCall).mockRejectedValue(new GasError('WRONG_PASSWORD', '비밀번호가 올바르지 않습니다.'));

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

  it('shows an officer as name and position', () => {
    useApp.setState({ profile: officer, menuOpen: true });
    render(<Header />);
    expect(screen.getByRole('button', { name: '김민수 · 기획처장' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '보직 다시 선택' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'admin으로 변환' })).toBeTruthy();
  });
});
