import { zipSync } from 'fflate';

/** 본문 PDF는 압축 맨 위에 두고, 별첨·규정만 폴더로 넣습니다. */
export function sendArchivePath(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || 'file.pdf';
  if (parts.length >= 3 && parts[1] === '별첨') return ['별첨', ...parts.slice(2)].join('/');
  if (parts.length >= 3 && parts[1] === '규정') return ['규정', ...parts.slice(2)].join('/');
  if (parts.length >= 3 && parts[1] === '본문') return parts.slice(2).join('/') || fileName;
  if (parts.length >= 3) return parts.slice(1).join('/');
  return fileName;
}

export function materialFolderOf(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length >= 3) return parts[1];
  return '본문';
}

export function uniqueArchivePaths(paths: string[]): string[] {
  const seen = new Map<string, number>();
  return paths.map((path) => {
    const count = seen.get(path) ?? 0;
    seen.set(path, count + 1);
    if (count === 0) return path;
    const slash = path.lastIndexOf('/');
    const dot = path.lastIndexOf('.');
    const insertAt = dot > slash ? dot : path.length;
    return `${path.slice(0, insertAt)} (${count + 1})${path.slice(insertAt)}`;
  });
}

export function archiveFileName(folderDate: string): string {
  const date = folderDate.replace(/\.+$/, '') || folderDate || '자료';
  return `보직회의_${date}.zip`;
}

export function buildSendArchive(
  files: { path: string; bytes: Uint8Array }[],
  folderDate: string,
): { name: string; bytes: Uint8Array; entries: string[] } {
  const entries = uniqueArchivePaths(files.map((file) => sendArchivePath(file.path)));
  const packed: Record<string, Uint8Array> = {};
  files.forEach((file, index) => {
    packed[entries[index]] = file.bytes;
  });
  return { name: archiveFileName(folderDate), bytes: zipSync(packed, { level: 0 }), entries };
}
