import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PdfViewer } from '../components/viewer/PdfViewer';
import { useViewer } from '../state/viewer';

describe('memo tool order', () => {
  beforeEach(() => {
    useViewer.setState({ doc: null, file: null, local: null, loading: false, tool: 'select' });
  });

  it('places the eraser beside the pen', () => {
    render(<PdfViewer />);
    const pen = screen.getByRole('button', { name: '손글씨' });
    const eraser = screen.getByRole('button', { name: '지우개' });
    expect(pen.nextElementSibling).toBe(eraser);
    expect(pen.parentElement).toBe(eraser.parentElement);
    expect(eraser.nextElementSibling).toBe(screen.getByRole('button', { name: '필기 모두 지우기' }));
    expect(screen.getByRole('button', { name: '필기 모두 지우기' }).getAttribute('title')).toBe(
      '메모는 남기고 형광펜, 밑줄, 손글씨를 모두 지웁니다.',
    );
  });
});
