import type { Annotation, AnnotationRevision, MemoBackupPayload, MemoBackupRecord } from '../api/types';

export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function withChecksum(payload: Omit<MemoBackupPayload, 'checksum'>): Promise<MemoBackupPayload> {
  const checksum = await sha256Hex(canonicalJson(payload));
  return { ...payload, checksum };
}

export async function verifyBackup(payload: MemoBackupPayload): Promise<boolean> {
  if (payload.format !== 'bojik-memo-backup' || payload.schemaVersion !== 1) return false;
  const { checksum, ...rest } = payload;
  const next = await sha256Hex(canonicalJson(rest));
  return next === checksum;
}

export interface MergeCounts {
  added: number;
  updated: number;
  same: number;
}

export function mergeAnnotations(
  current: Annotation[],
  incoming: Annotation[],
  at: string,
): { annotations: Annotation[]; revisions: AnnotationRevision[]; counts: MergeCounts } {
  const byId = new Map(current.map((ann) => [ann.id, ann]));
  const revisions: AnnotationRevision[] = [];
  const counts: MergeCounts = { added: 0, updated: 0, same: 0 };
  for (const next of incoming) {
    const prev = byId.get(next.id);
    if (!prev) {
      byId.set(next.id, next);
      counts.added += 1;
      revisions.push({
        annotationId: next.id,
        version: next.version,
        action: 'restore',
        snapshot: stripId(next),
        at,
      });
      continue;
    }
    if (prev.updatedAt === next.updatedAt) {
      counts.same += 1;
      continue;
    }
    const winner = prev.updatedAt > next.updatedAt ? prev : next;
    const loser = winner === prev ? next : prev;
    byId.set(next.id, winner);
    counts.updated += 1;
    revisions.push({
      annotationId: loser.id,
      version: loser.version,
      action: 'restore',
      snapshot: stripId(loser),
      at,
    });
  }
  return { annotations: [...byId.values()], revisions, counts };
}

function stripId(ann: Annotation): Omit<Annotation, 'id'> {
  const { id: _id, ...snapshot } = ann;
  return snapshot;
}

export function contentHashSource(annotations: Annotation[]): string {
  return canonicalJson(
    annotations
      .map((ann) => ({ id: ann.id, updatedAt: ann.updatedAt, status: ann.status, content: ann.content, page: ann.page }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  );
}

export interface PruneItem {
  id: string;
  createdAt: string;
  sizeBytes: number;
}

export function selectBackupsToDelete(
  records: PruneItem[],
  opts: { now: number; retentionDays: number; maxTotalBytes: number },
): string[] {
  if (!records.length) return [];
  const newestFirst = records.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const newest = newestFirst[0];
  const cutoff = opts.now - opts.retentionDays * 24 * 60 * 60 * 1000;
  let kept = newestFirst.filter((record, index) => index === 0 || Date.parse(record.createdAt) >= cutoff);
  let total = kept.reduce((sum, record) => sum + record.sizeBytes, 0);
  const removed: string[] = [];
  const droppedByAge = newestFirst.filter((record) => !kept.some((item) => item.id === record.id));
  removed.push(...droppedByAge.map((record) => record.id));
  while (total > opts.maxTotalBytes && kept.length > 1) {
    const oldest = kept[kept.length - 1];
    if (oldest.id === newest.id) break;
    kept = kept.slice(0, -1);
    total -= oldest.sizeBytes;
    removed.push(oldest.id);
  }
  if (!kept.some((record) => record.id === newest.id)) kept = [newest, ...kept];
  return removed.filter((id) => id !== newest.id);
}

export function backupByteSize(record: Pick<MemoBackupRecord, 'data'>): number {
  return new TextEncoder().encode(JSON.stringify(record.data)).length;
}
