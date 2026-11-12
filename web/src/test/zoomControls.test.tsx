import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ZoomControls } from '../components/viewer/ZoomControls';
import { useViewer } from '../state/viewer';

describe('zoom percent input', () => {
  afterEach(() => {
    cleanup();
    useViewer.setState({ zoom: 1, fit: 'width', page: 1, pageCount: 3 });
  });

  it('applies a typed percent between the zoom buttons', () => {
    useViewer.setState({ zoom: 1, fit: 'width', page: 1, pageCount: 3 });
    render(<ZoomControls />);
    const input = screen.getByRole('textbox', { name: '확대 비율' }) as HTMLInputElement;
    expect(input.value).toBe('100');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(useViewer.getState().zoom).toBe(1.5);
    expect(useViewer.getState().fit).toBe('custom');
    expect(input.value).toBe('150');
  });

  it('clamps a typed percent to the zoom range', () => {
    useViewer.setState({ zoom: 1, fit: 'width' });
    render(<ZoomControls />);
    const input = screen.getByRole('textbox', { name: '확대 비율' }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '900' } });
    fireEvent.blur(input);
    expect(useViewer.getState().zoom).toBe(4);
    expect(input.value).toBe('400');
  });

  it('keeps the current zoom when the entry is cleared or cancelled', () => {
    useViewer.setState({ zoom: 1.25, fit: 'custom' });
    render(<ZoomControls />);
    const input = screen.getByRole('textbox', { name: '확대 비율' }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(useViewer.getState().zoom).toBe(1.25);
    expect(input.value).toBe('125');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(useViewer.getState().zoom).toBe(1.25);
    expect(input.value).toBe('125');
  });
});
