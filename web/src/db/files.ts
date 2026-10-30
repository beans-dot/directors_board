import type { LocalFile, PdfBlobRecord } from '../api/types';
import { pdfRetentionPlan } from '../domain/pdfRetention';
import { getDB } from './schema';

export async function upsertFile(file: LocalFile): Promise<void> {
  const db = await getDB();
  await db.put('files', file);
}

export async function getFile(id: string): Promise<LocalFile | undefined> {
  const db = await getDB();
  return db.get('files', id);
}

export async function listFiles(): Promise<LocalFile[]> {
  const db = await getDB();
  return db.getAll('files');
}

export async function putPdfBlob(record: PdfBlobRecord): Promise<void> {
  const db = await getDB();
  await db.put('pdfBlobs', record);
}

export async function getPdfBlob(key: string): Promise<PdfBlobRecord | undefined> {
  const db = await getDB();
  return db.get('pdfBlobs', key);
}

export function blobKey(fileId: string, md5: string | undefined, modifiedTime: string): string {
  return `${fileId}@${md5 || modifiedTime}`;
}

export async function pruneExpiredPdfs(now = Date.now()): Promise<number> {
  const db = await getDB();
  const files = await db.getAll('files');
  const plans = files.map((file) => ({ file, plan: pdfRetentionPlan(file, now) }));
  const changed = plans.filter(({ plan }) => plan.clearCurrent || plan.dropBlobKeys.length > 0);
  if (!changed.length) return 0;
  const tx = db.transaction(['files', 'pdfBlobs'], 'readwrite');
  for (const { file, plan } of changed) {
    for (const key of plan.dropBlobKeys) await tx.objectStore('pdfBlobs').delete(key);
    const next: LocalFile = {
      ...file,
      currentBlobKey: plan.clearCurrent ? undefined : file.currentBlobKey,
      versions: file.versions.filter((version) => !plan.dropBlobKeys.includes(version.blobKey)),
    };
    await tx.objectStore('files').put(next);
  }
  await tx.done;
  return changed.length;
}
