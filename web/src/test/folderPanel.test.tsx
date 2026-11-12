import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LeftPanel } from '../components/layout/LeftPanel';
import { useApp } from '../state/app';

describe('folder panel', () => {
  it('folds the mail button and folder list together from the side tab', () => {
    useApp.setState({ folderOpen: true });
    render(<LeftPanel />);

    const openTab = screen.getByRole('button', { name: '자료 접기' });
    expect(openTab.getAttribute('aria-expanded')).toBe('true');
    expect(openTab.closest('aside')?.classList.contains('expanded')).toBe(true);
    expect(screen.getByRole('button', { name: /전체 회의자료 내려받기/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeTruthy();

    fireEvent.click(openTab);

    const closedTab = screen.getByRole('button', { name: '자료 보기' });
    expect(closedTab.getAttribute('aria-expanded')).toBe('false');
    expect(closedTab.closest('aside')?.classList.contains('expanded')).toBe(false);
    expect(screen.getByRole('button', { name: /전체 회의자료 내려받기/ })).toBeTruthy();
    expect(useApp.getState().folderOpen).toBe(false);

    fireEvent.click(closedTab);
    expect(screen.getByRole('button', { name: '자료 접기' }).getAttribute('aria-expanded')).toBe('true');
    expect(useApp.getState().folderOpen).toBe(true);
  });
});
