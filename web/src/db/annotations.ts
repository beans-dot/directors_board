import type { Annotation, AnnotationRevision } from '../api/types';
import { getDB } from './schema';

function snapshot(ann: Annotation): Omit<Annotation, 'id'> {
  const { id: _id, ...rest } = ann;
  return rest;
}

export async function writeAnnotation(
  ann: Annotation,
  action: AnnotationRevision['action'],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['annotations', 'annotationRevisions'], 'readwrite');
  await tx.objectStore('annotations').put(ann);
  await tx.objectStore('annotationRevisions').add({
    annotationId: ann.id,
    version: ann.version,
    action,
    snapshot: snapshot(ann),
    at: ann.updatedAt,
  });
  await tx.done;
}

export async function listAnnotationsByFile(driveFileId: string): Promise<Annotation[]> {
  const db = await getDB();
  return db.getAllFromIndex('annotations', 'byFile', driveFileId);
}

export async function listAnnotationsByFolder(folderDate: string): Promise<Annotation[]> {
  const db = await getDB();
  return db.getAllFromIndex('annotations', 'byFolderDate', folderDate);
}

export async function listActiveAnnotations(): Promise<Annotation[]> {
  const db = await getDB();
  const all = await db.getAll('annotations');
  return all.filter((ann) => ann.status === 'active');
}

export async function listAllAnnotations(): Promise<Annotation[]> {
  const db = await getDB();
  return db.getAll('annotations');
}

export async function deleteAnnotation(id: string): Promise<void> {
  await deleteAnnotations([id]);
}

export async function deleteAnnotations(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDB();
  const gone = new Set(ids);
  const tx = db.transaction(['annotations', 'annotationRevisions'], 'readwrite');
  for (const id of ids) await tx.objectStore('annotations').delete(id);
  let cursor = await tx.objectStore('annotationRevisions').openCursor();
  while (cursor) {
    if (gone.has(cursor.value.annotationId)) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function purgeDeletedMemos(): Promise<number> {
  const ids = (await listAllAnnotations()).filter((ann) => ann.type === 'pin' && ann.status === 'deleted').map((ann) => ann.id);
  await deleteAnnotations(ids);
  return ids.length;
}

export async function listRevisions(annotationId: string): Promise<AnnotationRevision[]> {
  const db = await getDB();
  return db.getAllFromIndex('annotationRevisions', 'byAnnotation', annotationId);
}

export async function countActiveByFile(driveFileId: string): Promise<number> {
  const rows = await listAnnotationsByFile(driveFileId);
  return rows.filter((ann) => ann.status === 'active').length;
}
