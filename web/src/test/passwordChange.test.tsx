import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../api/types';
import { PasswordDialog } from '../components/onboarding/PasswordDialog';
import { changeOwnPassword } from '../services/runtime';
import { useApp } from '../state/app';

vi.mock('../services/runtime', async () => {
  const actual = await vi.importActual<typeof import('../services/runtime')>('../services/runtime');
  return { ...actual, changeOwnPassword: vi.fn() };
});

const officer: Profile = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  name: '김민수',
  position: '기획처장',
  role: 'user',
  officerId: 'officer-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  registeredAt: '2026-01-01T00:00:00.000Z',
};

function fillNew(next: string, again: string) {
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: again } });
}

function fill(current: string, next: string, again: string) {
  fireEvent.change(screen.getByLabelText('현재 비밀번호'), { target: { value: current } });
  fillNew(next, again);
}

describe('password change confirmation', () => {
  beforeEach(() => {
    vi.mocked(changeOwnPassword).mockReset();
    vi.mocked(changeOwnPassword).mockResolvedValue();
    useApp.setState({
      profile: officer,
      showPassword: true,
      passwordRequired: true,
      toasts: [],
    });
  });

  it('tells an admin that the first password is admin', () => {
    useApp.setState({ profile: { ...officer, role: 'admin', name: '관리자', position: '기획처', officerId: undefined } });
    render(<PasswordDialog />);
    expect(screen.getByText('처음 로그인 비밀번호는 admin입니다. 새 비밀번호를 두 번 입력합니다.')).toBeTruthy();
    expect(screen.getByLabelText('새 비밀번호 확인')).toBeTruthy();
  });

  it('asks for the new password twice after the first login', async () => {
    render(<PasswordDialog />);
    expect(screen.getByRole('heading', { name: '비밀번호를 새로 설정해 주세요' })).toBeTruthy();
    expect(screen.queryByLabelText('현재 비밀번호')).toBeNull();
    expect(screen.getByLabelText('새 비밀번호')).toBeTruthy();
    expect(screen.getByLabelText('새 비밀번호 확인')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull();
    fillNew('meeting-0812', 'meeting-9999');
    expect(screen.getByText('새 비밀번호가 서로 다릅니다.')).toBeTruthy();
    expect((screen.getByRole('button', { name: '비밀번호 저장' }) as HTMLButtonElement).disabled).toBe(true);
    expect(changeOwnPassword).not.toHaveBeenCalled();
    fillNew('meeting-0812', 'meeting-0812');
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 저장' }));
    expect(changeOwnPassword).toHaveBeenCalledWith('', 'meeting-0812');
    await waitFor(() => expect(useApp.getState().toasts.at(-1)?.text).toBe('비밀번호를 저장했습니다.'));
  });

  it('saves only when both new passwords match', async () => {
    useApp.setState({ passwordRequired: false });
    render(<PasswordDialog />);
    expect(screen.getByRole('heading', { name: '비밀번호 변경' })).toBeTruthy();
    fill('meeting-0812', 'next-pass1', 'next-pass1');
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 저장' }));
    expect(changeOwnPassword).toHaveBeenCalledWith('meeting-0812', 'next-pass1');
    await waitFor(() => expect(useApp.getState().toasts.at(-1)?.text).toBe('비밀번호를 저장했습니다.'));
  });
});
