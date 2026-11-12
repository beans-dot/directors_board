import type { MemoBackupRecord } from '../api/types';
import { dropDeletedMemos, selectBackupsToDelete, withChecksum, type PruneItem } from '../domain/backup';
import { getDB } from './schema';

export async function addMemoBackup(record: MemoBackupRecord): Promise<void> {
  const db = await getDB();
  await db.put('memoBackups', record);
  await pruneStoredBackups();
}

export async function listMemoBackups(): Promise<MemoBackupRecord[]> {
  const db = await getDB();
  const rows = await db.getAll('memoBackups');
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getBackupSettings(): Promise<{ retentionDays: number; maxTotalBytes: number }> {
  const db = await getDB();
  const settings = (await db.get('kv', 'backupSettings')) as
    | { retentionDays?: number; maxTotalBytes?: number }
    | undefined;
  return {
    retentionDays: settings?.retentionDays ?? 90,
    maxTotalBytes: settings?.maxTotalBytes ?? 50 * 1024 * 1024,
  };
}

export async function purgeDeletedMemosFromBackups(): Promise<number> {
  const db = await getDB();
  const rows = await db.getAll('memoBackups');
  let removed = 0;
  for (const row of rows) {
    const next = dropDeletedMemos(row.data);
    if (!next.removed) continue;
    removed += next.removed;
    const data = await withChecksum(next.payload);
    const annotationCount = data.folders.reduce(
      (sum, folder) => sum + folder.files.reduce((fileSum, file) => fileSum + file.annotations.length, 0),
      0,
    );
    await db.put('memoBackups', {
      ...row,
      data,
      annotationCount,
      sizeBytes: new TextEncoder().encode(JSON.stringify(data)).length,
    });
  }
  return removed;
}

export async function pruneStoredBackups(now = Date.now()): Promise<string[]> {
  const db = await getDB();
  const rows = await db.getAll('memoBackups');
  const settings = await getBackupSettings();
  const items: PruneItem[] = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    sizeBytes: row.sizeBytes,
  }));
  const remove = selectBackupsToDelete(items, { now, ...settings });
  const tx = db.transaction('memoBackups', 'readwrite');
  for (const id of remove) await tx.store.delete(id);
  await tx.done;
  return remove;
}
