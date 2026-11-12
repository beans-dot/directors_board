import type { Annotation, AnnotationRevision, MemoBackupPayload } from '../api/types';
import { listAllAnnotations, listRevisions } from '../db/annotations';
import { listFiles } from '../db/files';
import { kvGet, kvSet } from '../db/kv';
import { addMemoBackup, getBackupSettings, listMemoBackups, pruneStoredBackups } from '../db/memoBackups';
import { contentHashSource, isDeletedMemo, sha256Hex, verifyBackup, withChecksum, mergeAnnotations } from '../domain/backup';
import { writeAnnotation } from '../db/annotations';
import { useApp } from '../state/app';
import { useMemoStore } from '../state/memo';
import { useViewer } from '../state/viewer';

export async function autoBackup(reason: 'auto' | 'manual' | 'before-restore' = 'auto'): Promise<void> {
  const profile = useApp.getState().profile;
  if (!profile?.name) return;
  const annotations = await listAllAnnotations();
  const hash = await sha256Hex(contentHashSource(annotations));
  const previous = await kvGet<string>('lastBackupHash');
  if (reason === 'auto' && previous === hash) return;
  const payload = await buildPayload(annotations);
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  await addMemoBackup({
    id: crypto.randomUUID(),
    createdAt: payload.createdAt,
    reason,
    sizeBytes: bytes,
    annotationCount: annotations.length,
    data: payload,
    diskSaved: 'none',
  });
  await kvSet('lastBackupHash', hash);
  const disk = await writeDisk(payload);
  if (disk) {
    useApp.getState().toast(`메모를 백업했습니다(${payload.createdAt.slice(11, 16)}, ${Math.ceil(bytes / 1024)}KB).`);
  }
  await pruneStoredBackups();
  await pruneDisk();
}

async function buildPayload(annotations: Annotation[]): Promise<MemoBackupPayload> {
  const profile = useApp.getState().profile!;
  const files = await listFiles();
  const byFile = new Map<string, Annotation[]>();
  for (const ann of annotations) {
    const list = byFile.get(ann.driveFileId) ?? [];
    list.push(ann);
    byFile.set(ann.driveFileId, list);
  }
  const folders = new Map<string, MemoBackupPayload['folders'][number]['files']>();
  for (const [fileId, anns] of byFile) {
    const meta = files.find((file) => file.driveFileId === fileId);
    const folderDate = anns[0]?.folderDate || meta?.folderDate || '';
    const revisions: AnnotationRevision[] = [];
    for (const ann of anns) revisions.push(...(await listRevisions(ann.id)));
    const bucket = folders.get(folderDate) ?? [];
    bucket.push({
      driveFileId: fileId,
      path: meta?.path || anns[0]?.path || '',
      name: meta?.name || '',
      modifiedTime: meta?.modifiedTime || '',
      md5: meta?.md5,
      annotations: anns,
      revisions,
    });
    folders.set(folderDate, bucket);
  }
  return withChecksum({
    format: 'bojik-memo-backup',
    schemaVersion: 1,
    deviceId: profile.deviceId,
    profile: { name: profile.name, position: profile.position },
    createdAt: new Date().toISOString(),
    scope: 'all',
    folders: [...folders.entries()].map(([folderDate, fileList]) => ({ folderDate, files: fileList })),
  });
}

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  entries(): AsyncIterable<[string, FileSystemHandle]>;
};

function asDir(handle: FileSystemDirectoryHandle): DirHandle {
  return handle as DirHandle;
}

async function writeDisk(payload: MemoBackupPayload): Promise<boolean> {
  const stored = await kvGet<FileSystemDirectoryHandle>('backupDirHandle');
  if (!stored || !('queryPermission' in stored)) return false;
  const handle = asDir(stored);
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return false;
  const stamp = payload.createdAt.replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const file = await handle.getFileHandle(`bojik-memo-backup_${stamp}.json`, { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify(payload));
  await writable.close();
  await kvSet('backupSettings', { ...(await getBackupSettings()), diskMode: 'folder', lastDiskBackupAt: payload.createdAt, lastAutoBackupAt: payload.createdAt });
  return true;
}

export async function chooseBackupFolder(): Promise<void> {
  const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) {
    useApp.getState().toast('이 브라우저는 폴더 저장을 지원하지 않습니다. 백업 파일을 내려받으세요.');
    return;
  }
  const handle = await picker();
  await kvSet('backupDirHandle', handle);
  useApp.getState().toast('백업 폴더를 지정했습니다.');
}

export function downloadBackup(payload: MemoBackupPayload): void {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `bojik-memo-backup_${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function restoreBackup(payload: MemoBackupPayload): Promise<void> {
  if (!(await verifyBackup(payload))) throw new Error('백업 파일을 확인할 수 없습니다.');
  const profile = useApp.getState().profile;
  if (profile && payload.deviceId !== profile.deviceId) {
    useApp.getState().toast('다른 기기의 백업입니다. 메모만 가져옵니다.');
  }
  await autoBackup('before-restore');
  const current = await listAllAnnotations();
  const incoming = payload.folders
    .flatMap((folder) => folder.files.flatMap((file) => file.annotations))
    .filter((ann) => !isDeletedMemo(ann));
  const merged = mergeAnnotations(current, incoming, new Date().toISOString());
  for (const ann of merged.annotations) await writeAnnotation(ann, 'restore');
  const openFile = useViewer.getState().file;
  if (openFile) {
    const { listAnnotationsByFile, listAnnotationsByFolder } = await import('../db/annotations');
    const folderDate = openFile.path.split('/')[0] || '';
    const items = folderDate ? await listAnnotationsByFolder(folderDate) : await listAnnotationsByFile(openFile.id);
    useMemoStore.getState().patch({ items });
  }
  useApp.getState().toast(`백업에서 메모 ${merged.counts.added + merged.counts.updated}개를 복원했습니다. 복원 전 상태도 백업해 두었습니다.`);
}

export async function backupSummary(): Promise<{ count: number; bytes: number; latest?: string; days: number }> {
  const rows = await listMemoBackups();
  const settings = await getBackupSettings();
  return {
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
    latest: rows[0]?.createdAt,
    days: settings.retentionDays,
  };
}

async function pruneDisk(): Promise<void> {
  const stored = await kvGet<FileSystemDirectoryHandle>('backupDirHandle');
  if (!stored || !('queryPermission' in stored)) return;
  const handle = asDir(stored);
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return;
  const settings = await getBackupSettings();
  const cutoff = Date.now() - settings.retentionDays * 86400000;
  for await (const [name] of handle.entries()) {
    if (!name.startsWith('bojik-memo-backup_')) continue;
    const file = await handle.getFileHandle(name);
    const info = await file.getFile();
    if (info.lastModified < cutoff) await handle.removeEntry(name);
  }
}

export async function saveRetention(days: number): Promise<void> {
  const current = await getBackupSettings();
  await kvSet('backupSettings', { ...current, retentionDays: days, diskMode: current.maxTotalBytes ? 'folder' : 'download' });
  await pruneStoredBackups();
}
