import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstVisitDialog } from '../components/onboarding/FirstVisitDialog';
import { loginAdmin, loginAsOfficer } from '../services/runtime';
import { useApp } from '../state/app';

vi.mock('../services/runtime', () => ({
  loginAdmin: vi.fn(),
  loginAsOfficer: vi.fn(),
  loadPublicConfig: vi.fn(),
  messageOf: (error: Error) => error.message,
}));

const officer = { id: 'user_kim1111', position: '기획처장', name: '김민수', email: '', employeeNo: '' };

describe('click login', () => {
  beforeEach(() => {
    vi.mocked(loginAdmin).mockReset().mockResolvedValue();
    vi.mocked(loginAsOfficer).mockReset().mockResolvedValue();
    useApp.setState({
      showOnboarding: true,
      profile: null,
      online: true,
      statusText: '',
      config: { today: '26.11.23.', maxAttachBytes: 26_214_400, allowedRecipientDomain: 'yeonsung.ac.kr', officers: [officer] },
    });
  });

  it('logs in an officer with one click and no input fields', async () => {
    const { container } = render(<FirstVisitDialog />);
    expect(container.querySelector('input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '기획처장 김민수' }));
    expect(loginAsOfficer).toHaveBeenCalledWith(officer);
    expect(loginAdmin).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '기획처장 김민수' })).not.toBeDisabled());
  });

  it('logs in an admin with one click', async () => {
    render(<FirstVisitDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'admin으로 들어가기' }));
    expect(loginAdmin).toHaveBeenCalledWith();
    await waitFor(() => expect(screen.getByRole('button', { name: 'admin으로 들어가기' })).not.toBeDisabled());
  });

  it('blocks repeated and cross-account clicks while signing in, then allows retry after a failure', async () => {
    let rejectLogin!: (error: Error) => void;
    vi.mocked(loginAsOfficer).mockImplementation(() => new Promise((_, reject) => { rejectLogin = reject; }));
    render(<FirstVisitDialog />);
    const choice = screen.getByRole('button', { name: '기획처장 김민수' });
    fireEvent.click(choice);
    expect(choice).toBeDisabled();
    expect(screen.getByRole('button', { name: 'admin으로 들어가기' })).toBeDisabled();
    fireEvent.click(choice);
    expect(loginAsOfficer).toHaveBeenCalledTimes(1);
    rejectLogin(new Error('서버와 연결하지 못했습니다.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('서버와 연결하지 못했습니다.');
    expect(choice).not.toBeDisabled();
    vi.mocked(loginAsOfficer).mockResolvedValue();
    fireEvent.click(choice);
    expect(loginAsOfficer).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(choice).not.toBeDisabled());
  });

  it('disables entry while offline and for officers without a name', () => {
    useApp.setState({ online: false });
    const { rerender } = render(<FirstVisitDialog />);
    expect(screen.getByRole('button', { name: '기획처장 김민수' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'admin으로 들어가기' })).toBeDisabled();
    act(() => useApp.setState({ online: true, config: { ...useApp.getState().config!, officers: [{ ...officer, name: '' }] } }));
    rerender(<FirstVisitDialog />);
    expect(screen.getByRole('button', { name: '기획처장 이름 설정 전' })).toBeDisabled();
  });
});
