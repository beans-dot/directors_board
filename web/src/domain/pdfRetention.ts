import { parseFolderDate } from './folderDate';

export const STORED_PDF_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoredPdfVersion {
  blobKey: string;
  replacedAt: string;
}

export interface StoredPdfFile {
  downloadedAt?: string;
  folderDate?: string;
  currentBlobKey?: string;
  versions: StoredPdfVersion[];
}

export interface PdfRetentionPlan {
  dropBlobKeys: string[];
  clearCurrent: boolean;
}

function instant(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function folderInstant(folderDate?: string): number | null {
  const parsed = folderDate ? parseFolderDate(folderDate) : null;
  if (!parsed) return null;
  return instant(`${parsed.dateKey}T00:00:00+09:00`);
}

/** Drop PDF bytes kept longer than 90 days. Memos are not part of this plan. */
export function pdfRetentionPlan(file: StoredPdfFile, now: number, retentionDays = STORED_PDF_RETENTION_DAYS): PdfRetentionPlan {
  const cutoff = now - retentionDays * DAY_MS;
  const storedAt = instant(file.downloadedAt) ?? folderInstant(file.folderDate);
  const clearCurrent = Boolean(file.currentBlobKey) && storedAt !== null && storedAt <= cutoff;
  const kept = new Set<string>();
  if (!clearCurrent && file.currentBlobKey) kept.add(file.currentBlobKey);
  for (const version of file.versions) {
    const replacedAt = instant(version.replacedAt);
    if (replacedAt !== null && replacedAt > cutoff) kept.add(version.blobKey);
  }
  const drop = new Set<string>();
  if (clearCurrent && file.currentBlobKey && !kept.has(file.currentBlobKey)) drop.add(file.currentBlobKey);
  for (const version of file.versions) {
    const replacedAt = instant(version.replacedAt);
    if (replacedAt !== null && replacedAt <= cutoff && !kept.has(version.blobKey)) drop.add(version.blobKey);
  }
  return { dropBlobKeys: [...drop], clearCurrent };
}
