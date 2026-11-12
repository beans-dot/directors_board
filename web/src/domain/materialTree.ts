import type { DateFolder, DriveNode } from '../api/types';

function collect(node: DriveNode, files: Map<string, DriveNode>, dirs: Set<string>): void {
  if (node.kind === 'folder') dirs.add(node.path);
  else if (node.isPdf) files.set(node.path, node);
  node.children?.forEach((child) => collect(child, files, dirs));
}

function buildDateFolder(meta: DateFolder, files: Map<string, DriveNode>, dirs: Set<string>): DateFolder {
  const rootPath = meta.path || meta.folderDate;
  const root: DateFolder = { ...meta, path: rootPath, children: [] };
  const folders = new Map<string, DriveNode>([[rootPath, root]]);
  const dirList = [...dirs].filter((dir) => dir !== rootPath && dir.startsWith(`${rootPath}/`)).sort();
  for (const dir of dirList) {
    const slash = dir.lastIndexOf('/');
    const parent = folders.get(dir.slice(0, slash));
    if (!parent) continue;
    const node: DriveNode = {
      id: `dir:${dir}`,
      name: dir.slice(slash + 1),
      kind: 'folder',
      mimeType: 'application/vnd.google-apps.folder',
      isPdf: false,
      path: dir,
      children: [],
    };
    parent.children = [...(parent.children || []), node];
    folders.set(dir, node);
  }
  for (const file of files.values()) {
    const slash = file.path.lastIndexOf('/');
    const parent = folders.get(file.path.slice(0, slash));
    if (!parent) continue;
    parent.children = [...(parent.children || []), file];
  }
  return root;
}

function combineDateFolder(drive: DateFolder, local: DateFolder): DateFolder {
  const files = new Map<string, DriveNode>();
  const dirs = new Set<string>();
  collect(drive, files, dirs);
  collect(local, files, dirs);
  return buildDateFolder(local, files, dirs);
}

/** Server folders join the existing list. The same path keeps the server file. */
export function mergeMaterialFolders(drive: DateFolder[], local: DateFolder[] | null): DateFolder[] {
  if (!local) return drive;
  const driveBy = new Map(drive.map((folder) => [folder.dateKey, folder]));
  const localBy = new Map(local.map((folder) => [folder.dateKey, folder]));
  const merged: DateFolder[] = [];
  for (const key of new Set([...driveBy.keys(), ...localBy.keys()])) {
    const fromDrive = driveBy.get(key);
    const fromLocal = localBy.get(key);
    if (fromDrive && fromLocal) merged.push(combineDateFolder(fromDrive, fromLocal));
    else if (fromLocal) merged.push(fromLocal);
    else if (fromDrive) merged.push(fromDrive);
  }
  return merged;
}
