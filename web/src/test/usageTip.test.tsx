import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveUsageTips } from '../api/materials';
import type { Profile } from '../api/types';
import { UsageTipTab } from '../components/admin/UsageTipTab';
import { Header } from '../components/layout/Header';
import { formatKoreanDate } from '../domain/folderDate';
import { clampUsageTip, usageTipCharLimit, usageTipIntervalMs, usageTipRows } from '../domain/usageTip';
import { useAdmin } from '../state/admin';
import { useApp } from '../state/app';

vi.mock('../api/materials', async () => {
  const actual = await vi.importActual<typeof import('../api/materials')>('../api/materials');
  return { ...actual, saveUsageTips: vi.fn() };
});

const adminProfile: Profile = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  name: '관리자',
  position: '기획처',
  role: 'admin',
  adminToken: 'tok',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('usage tip limit', () => {
  it('counts characters that fit in the bar', () => {
    expect(usageTipCharLimit(140, 14)).toBe(10);
    expect(usageTipCharLimit(7, 14)).toBe(0);
    expect(usageTipCharLimit(13, 14)).toBe(0);
    expect(usageTipCharLimit(140, 0)).toBeNull();
    expect(usageTipCharLimit(5000, 14)).toBe(160);
    expect(usageTipIntervalMs('짧은 안내')).toBe(6000);
    expect(usageTipIntervalMs('가'.repeat(80))).toBe(10000);
    expect(usageTipIntervalMs('가'.repeat(200))).toBe(20000);
    expect(clampUsageTip('가나다라', 3)).toBe('가나다');
    expect(clampUsageTip('가\n나', 4)).toBe('가나');
    expect(usageTipRows(['가나다라'], 2)).toEqual(['가나']);
  });
});

describe('usage tip bar', () => {
  beforeEach(() => {
    useApp.setState({
      profile: null,
      config: {
        today: '26.11.09.',
        maxAttachBytes: 1,
        allowedRecipientDomain: 'yeonsung.ac.kr',
        usageTips: ['첫 번째 안내', '두 번째 안내'],
      },
      toasts: [],
    });
  });

  it('shows tips in place of the date', () => {
    render(<Header />);
    expect(screen.getByText('사용 Tip')).toBeTruthy();
    expect(document.querySelector('.usage-tip-live')?.textContent).toBe('첫 번째 안내');
    expect(screen.queryByText(formatKoreanDate())).toBeNull();
    expect(document.querySelector('.header-date')).toBeNull();
  });

  it('slides to the next tip after 6 seconds', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      render(<Header />);
      const track = document.querySelector('.usage-tip-track') as HTMLElement;
      expect(track.style.transform).toBe('translateY(-0px)');
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(document.querySelector('.usage-tip-live')?.textContent).toBe('첫 번째 안내');
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(document.querySelector('.usage-tip-live')?.textContent).toBe('두 번째 안내');
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(track.style.transform).toBe('translateY(-22px)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves to the previous and next tip from the arrows', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      render(<Header />);
      fireEvent.click(screen.getByRole('button', { name: '다음 사용 Tip' }));
      expect(document.querySelector('.usage-tip-live')?.textContent).toBe('두 번째 안내');
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        vi.advanceTimersByTime(490);
      });
      fireEvent.click(screen.getByRole('button', { name: '이전 사용 Tip' }));
      expect(document.querySelector('.usage-tip-live')?.textContent).toBe('첫 번째 안내');
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect((document.querySelector('.usage-tip-track') as HTMLElement).style.transform).toBe('translateY(-0px)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows longer reading time and pauses while hovered or focused', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const long = '가'.repeat(80);
      useApp.setState({ config: { ...useApp.getState().config!, usageTips: [long, '다음 안내'] } });
      render(<Header />);
      const bar = document.querySelector('.usage-tip') as HTMLElement;
      act(() => { vi.advanceTimersByTime(6000); });
      expect(document.querySelector('.usage-tip-live')?.textContent).toBe(long);
      fireEvent.mouseOver(bar);
      act(() => { vi.advanceTimersByTime(15000); });
      expect(document.querySelector('.usage-tip-live')?.textContent).toBe(long);
      const next = screen.getByRole('button', { name: '다음 사용 Tip' });
      fireEvent.focus(next);
      fireEvent.mouseOut(bar);
      act(() => { vi.advanceTimersByTime(15000); });
      expect(document.querySelector('.usage-tip-live')?.textContent).toBe(long);
      fireEvent.blur(next, { relatedTarget: document.body });
      act(() => { vi.advanceTimersByTime(10000); });
      expect(document.querySelector('.usage-tip-live')?.textContent).toBe('다음 안내');
      expect(bar.title).toBe('다음 안내');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('usage tip editor', () => {
  beforeEach(() => {
    vi.mocked(saveUsageTips).mockReset();
    useApp.setState({
      profile: adminProfile,
      toasts: [],
      usageTipLimit: 8,
      usageTipWidth: 120,
      config: {
        today: '26.11.09.',
        maxAttachBytes: 1,
        allowedRecipientDomain: 'yeonsung.ac.kr',
        usageTips: ['기존 안내'],
      },
    });
    useAdmin.setState({
      tab: 'tips',
      settings: {
        rootFolderSet: true,
        rootFolderName: '자료',
        senderEmail: 'board@yeonsung.ac.kr',
        aliases: [],
        mailFromName: '보직회의 지원 시스템',
        mailFromAlias: '',
        usageTips: ['기존 안내'],
      },
    });
  });

  it('limits and saves each tip to the measured single-line width', async () => {
    vi.mocked(saveUsageTips).mockResolvedValue(['가나다라마바사아', '둘째 안내']);
    render(<UsageTipTab />);
    expect(screen.getByText('현재 Tip 박스 한 줄 기준 8자 이내로 입력')).toBeTruthy();
    const first = screen.getByLabelText('사용 Tip 1') as HTMLInputElement;
    expect(first.value).toBe('기존 안내');
    expect(first.maxLength).toBe(8);
    expect(first.tagName).toBe('INPUT');
    fireEvent.change(first, { target: { value: '가나다라마바사아자' } });
    expect(first.value).toBe('가나다라마바사아');
    expect(screen.getByText('8/8')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '사용 Tip 추가' }));
    fireEvent.change(screen.getByLabelText('사용 Tip 2'), { target: { value: '둘째 안내' } });
    fireEvent.click(screen.getByRole('button', { name: '사용 Tip 저장' }));
    await waitFor(() => expect(useApp.getState().config?.usageTips).toEqual(['가나다라마바사아', '둘째 안내']));
    expect(saveUsageTips).toHaveBeenCalledWith(['가나다라마바사아', '둘째 안내']);
  });

  it('keeps saved text intact before measuring or after shrinking the header', () => {
    const long = '기존 안내 문장입니다. '.repeat(6);
    useAdmin.setState({ settings: { ...useAdmin.getState().settings!, usageTips: [long] } });
    useApp.setState({ usageTipLimit: 0 });
    render(<UsageTipTab />);
    const input = screen.getByLabelText('사용 Tip 1') as HTMLInputElement;
    expect(input.value).toBe(long.trim());
    expect(input.disabled).toBe(true);
    act(() => useApp.setState({ usageTipLimit: 5 }));
    expect(input.value).toBe(long.trim());
    expect(input.maxLength).toBe(5);
    expect(screen.getByRole('alert').textContent).toContain('한 줄 한도를 넘는 문구');
    const save = screen.getByRole('button', { name: '사용 Tip 저장' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(saveUsageTips).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '짧은 안내' } });
    expect(save.disabled).toBe(false);
  });

  it('updates the input limit when the tip box grows without changing the draft', () => {
    render(<UsageTipTab />);
    const input = screen.getByLabelText('사용 Tip 1') as HTMLInputElement;
    act(() => useApp.setState({ usageTipLimit: 12, usageTipWidth: 168 }));
    expect(input.maxLength).toBe(12);
    expect(input.value).toBe('기존 안내');
  });
});
