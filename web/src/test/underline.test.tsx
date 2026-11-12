import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriveNode } from '../api/types';
import { MemoLayer } from '../components/memo/MemoLayer';
import { useMemoStore } from '../state/memo';
import { useViewer } from '../state/viewer';

vi.mock('../services/runtime', () => ({ saveMemo: vi.fn(async () => undefined) }));

const file: DriveNode = {
  id: 'file-1',
  name: '본문.pdf',
  kind: 'file',
  mimeType: 'application/pdf',
  isPdf: true,
  path: '26.10.30./본문/본문.pdf',
};

function point(type: string, x: number, y: number) {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
}

describe('underline drawing', () => {
  beforeEach(() => {
    useMemoStore.setState({ items: [], activeId: null, editorId: null });
    useViewer.setState({ file, tool: 'underline', readOnly: false, color: 'red' });
  });

  it('keeps one line on the stroke after the pointer is released', async () => {
    const view = render(<MemoLayer page={1} rotate={0} width={200} height={400} />);
    const layer = view.container.querySelector('.memo-layer');
    if (!(layer instanceof HTMLElement)) throw new Error('memo layer missing');
    const box = {
      left: 0,
      top: 0,
      width: 200,
      height: 400,
      right: 200,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect;
    const previous = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => box;
    try {
      await act(async () => {
        layer.dispatchEvent(point('pointerdown', 20, 80));
        layer.dispatchEvent(point('pointermove', 140, 240));
        layer.dispatchEvent(point('pointerup', 140, 240));
      });

      const lines = view.container.querySelectorAll('line');
      expect(lines).toHaveLength(1);
      expect(lines[0].getAttribute('x1')).toBe('20');
      expect(lines[0].getAttribute('y1')).toBe('80');
      expect(lines[0].getAttribute('x2')).toBe('140');
      expect(lines[0].getAttribute('y2')).toBe('240');
      expect(useMemoStore.getState().items.filter((item) => item.type === 'underline')).toHaveLength(1);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = previous;
    }
  });

  it('draws the stroke onto the second pane file', async () => {
    const other: DriveNode = { ...file, id: 'file-2', name: '별첨.pdf', path: '26.11.02./별첨/별첨.pdf' };
    const view = render(<MemoLayer page={1} rotate={0} width={200} height={400} file={other} readOnly={false} />);
    const layer = view.container.querySelector('.memo-layer');
    if (!(layer instanceof HTMLElement)) throw new Error('memo layer missing');
    const box = {
      left: 0,
      top: 0,
      width: 200,
      height: 400,
      right: 200,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect;
    const previous = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => box;
    try {
      await act(async () => {
        layer.dispatchEvent(point('pointerdown', 20, 80));
        layer.dispatchEvent(point('pointermove', 140, 240));
        layer.dispatchEvent(point('pointerup', 140, 240));
      });
      const saved = useMemoStore.getState().items.filter((item) => item.type === 'underline');
      expect(saved).toHaveLength(1);
      expect(saved[0]?.driveFileId).toBe('file-2');
      expect(saved[0]?.path).toBe(other.path);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = previous;
    }
  });
});
