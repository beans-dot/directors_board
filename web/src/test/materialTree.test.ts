import { describe, expect, it } from 'vitest';
import type { DateFolder } from '../api/types';
import { mergeMaterialFolders } from '../domain/materialTree';

function folder(dateKey: string, id: string, fileName: string, fileId: string): DateFolder {
  const folderDate = '26.11.12.';
  return {
    id,
    name: folderDate,
    kind: 'folder',
    mimeType: 'application/vnd.google-apps.folder',
    isPdf: false,
    path: folderDate,
    folderDate,
    dateKey,
    children: [
      {
        id: `${id}-body`,
        name: '본문',
        kind: 'folder',
        mimeType: 'application/vnd.google-apps.folder',
        isPdf: false,
        path: `${folderDate}/본문`,
        children: [
          {
            id: fileId,
            name: fileName,
            kind: 'file',
            mimeType: 'application/pdf',
            isPdf: true,
            path: `${folderDate}/본문/${fileName}`,
          },
        ],
      },
    ],
  };
}

describe('material folder merge', () => {
  it('keeps a drive pdf and adds a server pdf in the same date', () => {
    const drive = [folder('2026-11-12', 'drive', '기존.pdf', 'drive-file')];
    const local = [folder('2026-11-12', 'mat_local', '신규.pdf', 'mat_file')];
    const merged = mergeMaterialFolders(drive, local);
    const names = JSON.stringify(merged);
    expect(names).toContain('기존.pdf');
    expect(names).toContain('신규.pdf');
    expect(merged[0].id).toBe('mat_local');
  });

  it('leaves the drive list alone when the materials server is down', () => {
    const drive = [folder('2026-11-12', 'drive', '기존.pdf', 'drive-file')];
    expect(mergeMaterialFolders(drive, null)).toEqual(drive);
  });
});
