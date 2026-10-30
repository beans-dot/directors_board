import type { DateFolder, DriveNode } from '../api/types';

export interface FlatFile {
  id: string;
  path: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

export interface TreeDiffResult {
  newFolderIds: string[];
  newFileIds: string[];
  replaced: Array<{ path: string; previousId: string; nextId: string; reason: 'checksum' | 'reupload' }>;
}

export function flattenFiles(nodes: DriveNode[], acc: FlatFile[] = []): FlatFile[] {
  for (const node of nodes) {
    if (node.kind === 'file') {
      acc.push({
        id: node.id,
        path: node.path,
        md5Checksum: node.md5Checksum,
        modifiedTime: node.modifiedTime,
      });
    }
    if (node.children) flattenFiles(node.children, acc);
  }
  return acc;
}

export function diffTrees(previous: DateFolder[] | null, next: DateFolder[]): TreeDiffResult {
  const prevFolders = new Set((previous ?? []).map((folder) => folder.id));
  const prevFiles = flattenFiles(previous ?? []);
  const nextFiles = flattenFiles(next);
  const prevById = new Map(prevFiles.map((file) => [file.id, file]));
  const prevByPath = new Map(prevFiles.map((file) => [file.path, file]));
  const nextIds = new Set(nextFiles.map((file) => file.id));

  const newFolderIds = next.filter((folder) => previous && !prevFolders.has(folder.id)).map((f) => f.id);
  const newFileIds: string[] = [];
  const replaced: TreeDiffResult['replaced'] = [];
  const replacedNext = new Set<string>();

  if (previous) {
    for (const file of nextFiles) {
      const same = prevById.get(file.id);
      if (same) {
        const changed =
          (file.md5Checksum && same.md5Checksum && file.md5Checksum !== same.md5Checksum) ||
          (file.modifiedTime && same.modifiedTime && file.modifiedTime !== same.modifiedTime);
        if (changed) {
          replaced.push({ path: file.path, previousId: same.id, nextId: file.id, reason: 'checksum' });
          replacedNext.add(file.id);
        }
        continue;
      }
      const atPath = prevByPath.get(file.path);
      if (atPath && !nextIds.has(atPath.id)) {
        replaced.push({ path: file.path, previousId: atPath.id, nextId: file.id, reason: 'reupload' });
        replacedNext.add(file.id);
        continue;
      }
      newFileIds.push(file.id);
    }
  }

  return { newFolderIds, newFileIds, replaced };
}
