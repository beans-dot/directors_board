import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Annotation,
  AnnotationRevision,
  LocalFile,
  MemoBackupRecord,
  OutboxEvent,
  PdfBlobRecord,
  Profile,
  SendRecord,
  TreeSnapshot,
} from '../api/types';
import { DB_NAME } from '../config';

export interface BojikDB extends DBSchema {
  profile: { key: string; value: Profile };
  files: { key: string; value: LocalFile; indexes: { byFolderDate: string; byPath: string } };
  pdfBlobs: { key: string; value: PdfBlobRecord };
  annotations: {
    key: string;
    value: Annotation;
    indexes: {
      byFile: string;
      byFolderDate: string;
      byFilePage: [string, number];
      byUpdated: string;
    };
  };
  annotationRevisions: { key: number; value: AnnotationRevision; indexes: { byAnnotation: string } };
  treeCache: { key: string; value: TreeSnapshot };
  sendHistory: { key: number; value: SendRecord; indexes: { byAt: string } };
  outbox: { key: number; value: OutboxEvent };
  memoBackups: { key: string; value: MemoBackupRecord; indexes: { byCreatedAt: string } };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<BojikDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<BojikDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BojikDB>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('profile');
        const files = db.createObjectStore('files', { keyPath: 'driveFileId' });
        files.createIndex('byFolderDate', 'folderDate');
        files.createIndex('byPath', 'path');
        db.createObjectStore('pdfBlobs', { keyPath: 'key' });
        const annotations = db.createObjectStore('annotations', { keyPath: 'id' });
        annotations.createIndex('byFile', 'driveFileId');
        annotations.createIndex('byFolderDate', 'folderDate');
        annotations.createIndex('byFilePage', ['driveFileId', 'page']);
        annotations.createIndex('byUpdated', 'updatedAt');
        const revisions = db.createObjectStore('annotationRevisions', { autoIncrement: true });
        revisions.createIndex('byAnnotation', 'annotationId');
        db.createObjectStore('treeCache');
        const sends = db.createObjectStore('sendHistory', { autoIncrement: true });
        sends.createIndex('byAt', 'at');
        db.createObjectStore('outbox', { autoIncrement: true });
        const backups = db.createObjectStore('memoBackups', { keyPath: 'id' });
        backups.createIndex('byCreatedAt', 'createdAt');
        db.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

export async function resetDBForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}
