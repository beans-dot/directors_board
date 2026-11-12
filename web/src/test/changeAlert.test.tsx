import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../api/types';
import App from '../App';
import { useApp } from '../state/app';

vi.mock('../services/runtime', () => ({ boot: vi.fn() }));

const admin: Profile = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  name: '관리자',
  position: '기획처',
  role: 'admin',
  adminToken: 'tok',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const notice = '자료가 바뀌었음 — 26.11.02./별첨/예산.pdf. 기존 메모를 같은 위치로 옮겼습니다.';

describe('file change alert', () => {
  beforeEach(() => {
    useApp.setState({
      profile: { ...admin, role: 'user', adminToken: undefined },
      replaceNotice: notice,
      showOnboarding: false,
      showAdminConvert: false,
      showBackup: false,
      showSend: false,
      screen: 'main',
      statusText: '',
      online: true,
    });
  });

  it('keeps the replacement dialog off the user screen', () => {
    const view = render(<App />);
    expect(screen.queryByRole('heading', { name: '자료가 바뀌었음' })).toBeNull();
    view.unmount();

    useApp.setState({ profile: admin });
    render(<App />);
    expect(screen.getByRole('heading', { name: '자료가 바뀌었음' })).toBeTruthy();
    expect(screen.getByText(notice)).toBeTruthy();
  });
});
