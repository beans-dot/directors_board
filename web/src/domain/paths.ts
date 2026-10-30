import type { DriveNode } from '../api/types';

export function collectPdfs(node: DriveNode): DriveNode[] {
  const found: DriveNode[] = [];
  const walk = (current: DriveNode) => {
    if (current.kind === 'file' && current.isPdf) found.push(current);
    current.children?.forEach(walk);
  };
  walk(node);
  return found;
}

export function topFolderOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 3) return parts[1];
  return '자료';
}

export function memoFileName(topFolder: string, originalName: string): string {
  const base = originalName.replace(/\.pdf$/i, '');
  return `${topFolder}_${base}_메모.pdf`;
}

type SendFolder = DriveNode & { folderDate?: string };

export function pickSendFolder<T extends SendFolder>(folders: T[], openPath: string, today: string): T | undefined {
  const matchesFile = folders.find((folder) => {
    const prefix = folder.path || folder.name;
    return Boolean(prefix && openPath) && (openPath === prefix || openPath.startsWith(`${prefix}/`));
  });
  if (matchesFile) return matchesFile;
  const withPdfs = folders.filter((folder) => collectPdfs(folder).length > 0);
  return (
    withPdfs.find((folder) => folder.folderDate === today) ||
    withPdfs[0] ||
    folders.find((folder) => folder.folderDate === today) ||
    folders[0]
  );
}
