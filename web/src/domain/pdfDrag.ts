import type { DriveNode } from '../api/types';

export const PDF_DRAG_MIME = 'application/x-directors-pdf';

let dragging: DriveNode | null = null;

export function pdfDragPayload(node: DriveNode): string {
  const { children: _children, ...file } = node;
  return JSON.stringify(file);
}

export function parsePdfDrag(raw: string): DriveNode | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DriveNode>;
    if (!value || value.kind !== 'file' || value.isPdf !== true || !value.id || !value.name || !value.path) return null;
    return {
      id: value.id,
      name: value.name,
      kind: 'file',
      mimeType: value.mimeType || 'application/pdf',
      isPdf: true,
      path: value.path,
      modifiedTime: value.modifiedTime,
      md5Checksum: value.md5Checksum,
      size: value.size,
    };
  } catch {
    return null;
  }
}

export function beginPdfDrag(node: DriveNode): void {
  dragging = {
    id: node.id,
    name: node.name,
    kind: 'file',
    mimeType: node.mimeType,
    isPdf: true,
    path: node.path,
    modifiedTime: node.modifiedTime,
    md5Checksum: node.md5Checksum,
    size: node.size,
  };
}

export function endPdfDrag(): void {
  dragging = null;
}

export function currentPdfDrag(): DriveNode | null {
  return dragging;
}

export function pdfDragTypeList(types: DataTransfer['types'] | undefined): boolean {
  if (!types) return false;
  const list = Array.from(types);
  return list.includes(PDF_DRAG_MIME);
}
