import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../api/types';
import { writeAnnotation } from '../db/annotations';
import { downloadOpenFile, setOpenMemoDraft } from '../services/runtime';

function pin(content: string): Annotation {
  return {
    id: 'pin-1',
    driveFileId: 'file-1',
    path: '26.11.09./본문/1_샘플.pdf',
    folderDate: '26.11.09.',
    topFolder: '본문',
    page: 1,
    x: 0.4,
    y: 0.3,
    w: 0.02,
    h: 0.02,
    type: 'pin',
    content,
    status: 'active',
    version: 1,
    createdAt: '2026-11-09T01:00:00.000Z',
    updatedAt: '2026-11-09T01:00:00.000Z',
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('download bakes the saved memo text', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setOpenMemoDraft(null);
  });

  it('sends the typed memo to the server before the pdf is built, even if another screen saved first', async () => {
    const memo = pin('회의 결론입니다');
    await writeAnnotation(memo, 'create');
    setOpenMemoDraft({ id: memo.id, text: memo.content, ann: memo });
    const puts: Array<{ annotation: Annotation; force?: boolean }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/memos') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { annotation: Annotation; force?: boolean };
        puts.push(body);
        if (!body.force) {
          return jsonResponse(409, {
            ok: false,
            error: { code: 'CONFLICT', message: '다른 화면에서 이 메모를 먼저 저장했습니다.' },
            data: { server: { ...body.annotation, content: '', version: 2 } },
          });
        }
        return jsonResponse(200, { ok: true, data: { annotation: { ...body.annotation, version: 3 } } });
      }
      if (url.includes('/download/file')) {
        return new Response(new Blob(['%PDF-1.4']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="sample.pdf"' },
        });
      }
      return jsonResponse(404, { ok: false, error: { message: '없음' } });
    }));
    Object.assign(URL, {
      createObjectURL: () => 'blob:memo',
      revokeObjectURL: () => undefined,
    });

    await downloadOpenFile('file-1', '1_샘플.pdf');

    expect(puts.map((item) => item.annotation.content)).toEqual(['회의 결론입니다', '회의 결론입니다']);
    expect(puts[1]?.force).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/download/file'))).toBe(true);
  });
});
