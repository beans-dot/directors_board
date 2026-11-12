import type { DateFolder, DriveNode } from '../api/types';

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

/** 별첨 이름이 `[부서명`으로 시작할 때의 나열 순서. 산학 자료는 산학협력단으로도 시작합니다. */
const ATTACHMENT_OFFICES = [
  ['기획처'],
  ['교무처'],
  ['입학홍보처'],
  ['학생취업처'],
  ['산학협력처', '산학협력단'],
  ['행정지원처'],
];

export function naturalCompare(a: string, b: string): number {
  const aNum = /^\d/.test(a);
  const bNum = /^\d/.test(b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  return collator.compare(a, b);
}

export function sortByName<T>(items: T[], nameOf: (item: T) => string): T[] {
  return items.slice().sort((a, b) => naturalCompare(nameOf(a), nameOf(b)));
}

function attachmentOfficeRank(name: string): number {
  const trimmed = name.trim();
  const bracket = trimmed.startsWith('[') || trimmed.startsWith('［');
  if (!bracket) return ATTACHMENT_OFFICES.length;
  const body = trimmed.slice(1).trimStart();
  const index = ATTACHMENT_OFFICES.findIndex((names) => names.some((office) => body.startsWith(office)));
  return index === -1 ? ATTACHMENT_OFFICES.length : index;
}

function compareAttachmentNames(a: string, b: string): number {
  const rank = attachmentOfficeRank(a) - attachmentOfficeRank(b);
  if (rank !== 0) return rank;
  return naturalCompare(a, b);
}

function sortAttachments(nodes: DriveNode[]): DriveNode[] {
  return nodes.slice().sort((a, b) => compareAttachmentNames(a.name, b.name));
}

function isDateFolder(node: DriveNode): node is DateFolder {
  return 'folderDate' in node && Boolean((node as DateFolder).folderDate);
}

function hasAnyFile(node: DriveNode): boolean {
  if (node.kind === 'file') return true;
  return (node.children ?? []).some(hasAnyFile);
}

function keepMaterialFolder(node: DriveNode): boolean {
  const name = node.name.trim();
  if (node.kind === 'folder' && (name === '본문' || name === '별첨' || name === '규정')) return hasAnyFile(node);
  return true;
}

function arrangeMeetingChildren(children: DriveNode[]): DriveNode[] {
  const rest: DriveNode[] = [];
  let body: DriveNode | undefined;
  let attachment: DriveNode | undefined;
  let regulation: DriveNode | undefined;

  for (const node of children) {
    const name = node.name.trim();
    if (node.kind === 'folder' && name === '본문') {
      if (hasAnyFile(node)) body = node;
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
    rest.push(node);
  }

  return [
    ...(body ? [body] : []),
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
  if (visible.name.trim() === '별첨') return { ...visible, children: sortAttachments(children) };
  return { ...visible, children: sortByName(children, (item) => item.name) };
}

export function sortDriveTree(folders: DateFolder[]): DateFolder[] {
  return folders
    .slice()
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))
    .map((folder) => sortNode(folder) as DateFolder);
}
