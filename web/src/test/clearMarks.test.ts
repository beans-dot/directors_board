import { beforeEach, describe, expect, it } from 'vitest';
import type { Annotation } from '../api/types';
import { listAnnotationsByFile, writeAnnotation } from '../db/annotations';
import { clearFileMarks } from '../services/runtime';
import { useMemoStore } from '../state/memo';

function mark(partial: Partial<Annotation> & Pick<Annotation, 'id' | 'type'>): Annotation {
  return {
    driveFileId: 'file-1',
    path: '26.10.30./본문/1.pdf',
    folderDate: '26.10.30.',
    topFolder: '본문',
    page: 1,
    x: 0.1,
    y: 0.2,
    w: 0.2,
    h: 0.01,
    content: '',
    status: 'active',
    version: 1,
    createdAt: '2026-10-30T01:00:00+09:00',
    updatedAt: '2026-10-30T01:00:00+09:00',
    ...partial,
  };
}

describe('clear file marks', () => {
  beforeEach(() => {
    useMemoStore.setState({ items: [], activeId: null, editorId: null });
  });

  it('deletes pen, highlight, and underline marks and leaves memos', async () => {
    const rows = [
      mark({ id: 'memo', type: 'pin', content: '남길 메모' }),
      mark({ id: 'pen', type: 'ink' }),
      mark({ id: 'line', type: 'underline' }),
      mark({ id: 'shade', type: 'highlight', page: 2 }),
      mark({ id: 'other', type: 'ink', driveFileId: 'file-2' }),
    ];
    for (const row of rows) await writeAnnotation(row, 'create');
    useMemoStore.setState({ items: rows });

    await expect(clearFileMarks('file-1')).resolves.toBe(3);

    const kept = await listAnnotationsByFile('file-1');
    expect(kept.find((item) => item.id === 'memo')?.status).toBe('active');
    expect(kept.filter((item) => item.status === 'deleted').map((item) => item.id).sort()).toEqual(['line', 'pen', 'shade']);
    expect(useMemoStore.getState().items.find((item) => item.id === 'other')?.status).toBe('active');
    expect(useMemoStore.getState().items.find((item) => item.id === 'memo')?.status).toBe('active');
  });
});
