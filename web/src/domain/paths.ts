import type { DateFolder, DriveNode } from '../api/types';
import { dateKeyToFolderDate } from './folderDate';

export function collectPdfs(node: DriveNode): DriveNode[] {
  const found: DriveNode[] = [];
  const walk = (current: DriveNode) => {
    if (current.kind === 'file' && current.isPdf) found.push(current);
    current.children?.forEach(walk);
  };
  walk(node);
  return found;
}

/** PDFs stored ahead of opening. Automatic preload is the meeting date only. */
export function preloadPdfNodes(folders: DateFolder[], scope: 'all' | 'meeting', meetingDate?: string): DriveNode[] {
  if (scope === 'meeting') {
    if (!meetingDate) return [];
    return folders.filter((item) => item.dateKey === meetingDate).flatMap((folder) => collectPdfs(folder));
  }
  const nodes = folders.flatMap((folder) => collectPdfs(folder));
  const folderDate = meetingDate ? dateKeyToFolderDate(meetingDate) : null;
  if (!folderDate) return nodes;
  const first: DriveNode[] = [];
  const rest: DriveNode[] = [];
  for (const node of nodes) {
    if (node.path === folderDate || node.path.startsWith(`${folderDate}/`)) first.push(node);
    else rest.push(node);
  }
  return [...first, ...rest];
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
