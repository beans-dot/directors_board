import type { DateFolder, DriveNode } from '../api/types';

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
  const aNum = /^\d/.test(a);
  const bNum = /^\d/.test(b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  return collator.compare(a, b);
}

export function sortByName<T>(items: T[], nameOf: (item: T) => string): T[] {
  return items.slice().sort((a, b) => naturalCompare(nameOf(a), nameOf(b)));
}

function isDateFolder(node: DriveNode): node is DateFolder {
  return 'folderDate' in node && Boolean((node as DateFolder).folderDate);
}

function isMeetingPdf(node: DriveNode): boolean {
  return node.kind === 'file' && node.isPdf && node.name.replace(/\s+/g, '').includes('보직회의자료');
}

function hasAnyFile(node: DriveNode): boolean {
  if (node.kind === 'file') return true;
  return (node.children ?? []).some(hasAnyFile);
}

function keepMaterialFolder(node: DriveNode): boolean {
  const name = node.name.trim();
  if (node.kind === 'folder' && (name === '별첨' || name === '규정')) return hasAnyFile(node);
  return true;
}

function arrangeMeetingChildren(children: DriveNode[]): DriveNode[] {
  const meeting: DriveNode[] = [];
  const rest: DriveNode[] = [];
  let attachment: DriveNode | undefined;
  let regulation: DriveNode | undefined;

  for (const node of children) {
    const name = node.name.trim();
    if (node.kind === 'folder' && name === '본문') {
      const kept: DriveNode[] = [];
      for (const child of node.children ?? []) {
        if (isMeetingPdf(child)) meeting.push(child);
        else kept.push(child);
      }
      if (kept.length) rest.push({ ...node, children: kept });
      continue;
    }
    if (node.kind === 'folder' && name === '별첨') {
      if (hasAnyFile(node)) attachment = node;
      continue;
    }
    if (node.kind === 'folder' && name === '규정') {
      if (hasAnyFile(node)) regulation = node;
      continue;
    }
    if (isMeetingPdf(node)) {
      meeting.push(node);
      continue;
    }
    rest.push(node);
  }

  return [
    ...sortByName(meeting, (item) => item.name),
    ...(attachment ? [attachment] : []),
    ...(regulation ? [regulation] : []),
    ...sortByName(rest, (item) => item.name),
  ];
}

function pdfsOnly(node: DriveNode): DriveNode | null {
  if (node.kind === 'file') return node.isPdf ? node : null;
  const children = (node.children ?? []).map(pdfsOnly).filter((child): child is DriveNode => child !== null);
  if (!isDateFolder(node) && children.length === 0) return null;
  return { ...node, children };
}

function sortNode(node: DriveNode): DriveNode {
  const visible = pdfsOnly(node) ?? node;
  if (!visible.children) return visible;
  const children = visible.children.map(sortNode).filter(keepMaterialFolder);
  if (isDateFolder(visible)) return { ...visible, children: arrangeMeetingChildren(children) };
  return { ...visible, children: sortByName(children, (item) => item.name) };
}

export function sortDriveTree(folders: DateFolder[]): DateFolder[] {
  return folders
    .slice()
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))
    .map((folder) => sortNode(folder) as DateFolder);
}
